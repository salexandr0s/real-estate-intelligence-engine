import type { DetailCapture, SourceRawListingBase, VersionReason } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';
import type { IngestRawResult, RawIngestionDeps } from './ingest-raw.js';
import { IngestRawListing } from './ingest-raw.js';
import type { NormalizationDeps, NormalizeAndUpsertResult } from './normalize-and-upsert.js';
import { NormalizeAndUpsert } from './normalize-and-upsert.js';
import type { ScoreAndAlertDeps, ScoreAndAlertResult } from './score-and-alert.js';
import { ScoreAndAlert } from './score-and-alert.js';
import type { SourceNormalizer } from '@immoradar/contracts';

const log = createLogger('ingestion:pipeline');

/**
 * Full ingestion pipeline:
 * 1. Persist raw snapshot
 * 2. Normalize to canonical listing
 * 3. Score the listing
 * 4. Match against filters and create alerts
 *
 * This is the complete end-to-end flow from scraper output to user-visible alerts.
 */

export interface FullIngestionResult {
  raw: IngestRawResult;
  normalization: NormalizeAndUpsertResult;
  scoring: ScoreAndAlertResult | null;
}

/** A listing version that no score points at yet. */
export interface UnscoredListingVersion {
  id: number;
  rawListingId: number;
  versionReason: VersionReason;
}

export interface FullIngestionPipelineDeps {
  raw: RawIngestionDeps;
  normalization: NormalizationDeps;
  scoreAndAlert: ScoreAndAlertDeps;
  /**
   * The listing's latest version if nothing has scored it yet. A retried job uses it
   * to score the version an earlier attempt wrote before scoring failed.
   */
  findUnscoredLatestVersion: (listingId: number) => Promise<UnscoredListingVersion | null>;
  persistAttachments?: (
    listingId: number,
    attachments: Array<{ url: string; label?: string; type?: string }>,
  ) => Promise<void>;
  /** Look up source health score (0-100) by source ID. Falls back to 90 if not provided. */
  getSourceHealthScore?: (sourceId: number) => Promise<number>;
  /** Look up geocode precision score (0-100) by listing ID. Falls back to 75 if not provided. */
  getLocationConfidence?: (listingId: number) => Promise<number>;
}

export class FullIngestionPipeline {
  private readonly rawIngestor: IngestRawListing;
  private readonly normalizer: NormalizeAndUpsert;
  private readonly scorer: ScoreAndAlert;
  private readonly findUnscoredLatestVersion: FullIngestionPipelineDeps['findUnscoredLatestVersion'];
  private readonly persistAttachments: (
    listingId: number,
    attachments: Array<{ url: string; label?: string; type?: string }>,
  ) => Promise<void>;
  private readonly getSourceHealthScore: (sourceId: number) => Promise<number>;
  private readonly getLocationConfidence: (listingId: number) => Promise<number>;

  constructor(normalizers: Map<string, SourceNormalizer>, deps: FullIngestionPipelineDeps) {
    this.rawIngestor = new IngestRawListing(deps.raw);
    this.normalizer = new NormalizeAndUpsert(normalizers, deps.normalization);
    this.scorer = new ScoreAndAlert(deps.scoreAndAlert);
    this.findUnscoredLatestVersion = deps.findUnscoredLatestVersion;
    this.persistAttachments = deps.persistAttachments ?? (async () => {});
    this.getSourceHealthScore = deps.getSourceHealthScore ?? (async () => 90);
    this.getLocationConfidence = deps.getLocationConfidence ?? (async () => 75);
  }

  async ingestDetailCapture<T extends SourceRawListingBase>(
    capture: DetailCapture<T>,
    sourceId: number,
    scrapeRunId: number,
  ): Promise<FullIngestionResult> {
    // Stage 1: Raw persistence
    const rawResult = await this.rawIngestor.ingest(capture, sourceId, scrapeRunId);

    log.info('Stage 1 complete: raw persisted', {
      rawListingId: rawResult.rawListingId,
      isNewSnapshot: rawResult.isNewSnapshot,
    });

    // Stage 2: Normalization
    const normResult = await this.normalizer.process(
      capture.sourceCode,
      capture.payload,
      {
        sourceId,
        sourceListingKey: rawResult.sourceListingKey,
        sourceExternalId: capture.externalId ?? null,
        rawListingId: rawResult.rawListingId,
        scrapeRunId,
        canonicalUrl: capture.canonicalUrl,
        detailUrl: capture.detailUrl,
        availabilityStatus: capture.availabilityStatus,
      },
      scrapeRunId,
    );

    log.info('Stage 2 complete: normalized', {
      listingId: normResult.listingId,
      isNew: normResult.isNew,
      versionReason: normResult.versionReason,
    });

    // Stage 3: Score and alert. A scoring error fails the job so that BullMQ retries it.
    let scoreResult: ScoreAndAlertResult | null = null;
    const listing = normResult.listing;
    const version = listing ? await this.findVersionToScore(rawResult, normResult) : null;

    if (listing && version) {
      const [sourceHealthScore, locationConfidence] = await Promise.all([
        this.getSourceHealthScore(sourceId),
        this.getLocationConfidence(normResult.listingId),
      ]);

      scoreResult = await this.scorer.process({
        listingId: normResult.listingId,
        listingVersionId: version.id,
        versionReason: version.versionReason,
        listing,
        sourceHealthScore,
        locationConfidence,
      });

      log.info('Stage 3 complete: scored and alerts checked', {
        overallScore: scoreResult.overallScore,
        alertsCreated: scoreResult.alertsCreated,
      });
    }

    // Stage 4: Persist attachment documents once the listing exists
    if (normResult.listingId > 0 && (capture.attachmentUrls?.length ?? 0) > 0) {
      try {
        await this.persistAttachments(normResult.listingId, capture.attachmentUrls ?? []);
        log.info('Stage 4 complete: attachments persisted', {
          listingId: normResult.listingId,
          attachmentCount: capture.attachmentUrls?.length ?? 0,
        });
      } catch (err) {
        log.error('Attachment persistence failed, continuing without document enqueue', {
          listingId: normResult.listingId,
          errorClass: 'attachment_persistence_failure',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      raw: rawResult,
      normalization: normResult,
      scoring: scoreResult,
    };
  }

  /**
   * The version this capture wrote or, when the capture changed nothing, the latest
   * version if this capture's raw snapshot wrote it and nothing scored it. That is a
   * retry of a job whose scoring failed after the version was written.
   */
  private async findVersionToScore(
    rawResult: IngestRawResult,
    normResult: NormalizeAndUpsertResult,
  ): Promise<{ id: number; versionReason: VersionReason } | null> {
    if (normResult.listingId <= 0) return null;
    if (normResult.listingVersionId != null && normResult.versionReason != null) {
      return { id: normResult.listingVersionId, versionReason: normResult.versionReason };
    }
    // A retry carries the same payload, so its raw snapshot exists already.
    if (rawResult.isNewSnapshot) return null;

    const unscored = await this.findUnscoredLatestVersion(normResult.listingId);
    if (!unscored || unscored.rawListingId !== rawResult.rawListingId) return null;

    log.info('Scoring the version an earlier attempt left unscored', {
      listingId: normResult.listingId,
      listingVersionId: unscored.id,
    });
    return { id: unscored.id, versionReason: unscored.versionReason };
  }
}
