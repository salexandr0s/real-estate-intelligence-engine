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

export interface FullIngestionPipelineDeps {
  raw: RawIngestionDeps;
  normalization: NormalizationDeps;
  scoreAndAlert: ScoreAndAlertDeps;
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

    // Stage 3: Score and alert (only if listing was created/changed)
    let scoreResult: ScoreAndAlertResult | null = null;

    if (
      normResult.listingId > 0 &&
      normResult.listingVersionId != null &&
      normResult.versionReason != null &&
      normResult.listing != null
    ) {
      try {
        const [sourceHealthScore, locationConfidence] = await Promise.all([
          this.getSourceHealthScore(sourceId),
          this.getLocationConfidence(normResult.listingId),
        ]);

        scoreResult = await this.scorer.process({
          listingId: normResult.listingId,
          listingVersionId: normResult.listingVersionId,
          versionReason: normResult.versionReason as VersionReason,
          listing: normResult.listing,
          sourceHealthScore,
          locationConfidence,
        });

        log.info('Stage 3 complete: scored and alerts checked', {
          overallScore: scoreResult.overallScore,
          alertsCreated: scoreResult.alertsCreated,
        });
      } catch (_err) {
        log.error('Scoring failed, continuing without score', {
          listingId: normResult.listingId,
          errorClass: 'scoring_failure',
        });
      }
    }

    // Stage 4: Persist attachment documents once the listing exists
    if (normResult.listingId > 0 && (capture.attachmentUrls?.length ?? 0) > 0) {
      try {
        await this.persistAttachments(normResult.listingId, capture.attachmentUrls ?? []);
        log.info('Stage 4 complete: attachments persisted', {
          listingId: normResult.listingId,
          attachmentCount: capture.attachmentUrls?.length ?? 0,
        });
      } catch (_err) {
        log.error('Attachment persistence failed, continuing without document enqueue', {
          listingId: normResult.listingId,
          errorClass: 'attachment_persistence_failure',
        });
      }
    }

    return {
      raw: rawResult,
      normalization: normResult,
      scoring: scoreResult,
    };
  }
}
