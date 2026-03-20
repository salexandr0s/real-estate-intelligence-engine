import type { DetailCapture, SourceRawListingBase, VersionReason } from '@rei/contracts';
import { createLogger } from '@rei/observability';
import type { IngestRawResult, RawIngestionDeps } from './ingest-raw.js';
import { IngestRawListing } from './ingest-raw.js';
import type { NormalizationDeps, NormalizeAndUpsertResult } from './normalize-and-upsert.js';
import { NormalizeAndUpsert } from './normalize-and-upsert.js';
import type { ScoreAndAlertDeps, ScoreAndAlertResult } from './score-and-alert.js';
import { ScoreAndAlert } from './score-and-alert.js';
import type { SourceNormalizer } from '@rei/contracts';

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
}

export class FullIngestionPipeline {
  private readonly rawIngestor: IngestRawListing;
  private readonly normalizer: NormalizeAndUpsert;
  private readonly scorer: ScoreAndAlert;

  constructor(
    normalizers: Map<string, SourceNormalizer>,
    deps: FullIngestionPipelineDeps,
  ) {
    this.rawIngestor = new IngestRawListing(deps.raw);
    this.normalizer = new NormalizeAndUpsert(normalizers, deps.normalization);
    this.scorer = new ScoreAndAlert(deps.scoreAndAlert);
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
        scoreResult = await this.scorer.process({
          listingId: normResult.listingId,
          listingVersionId: normResult.listingVersionId,
          versionReason: normResult.versionReason as VersionReason,
          listing: normResult.listing,
          sourceHealthScore: 90,
          locationConfidence: 75,
        });

        log.info('Stage 3 complete: scored and alerts checked', {
          overallScore: scoreResult.overallScore,
          alertsCreated: scoreResult.alertsCreated,
        });
      } catch (err) {
        log.error('Scoring failed, continuing without score', {
          listingId: normResult.listingId,
          errorClass: 'scoring_failure',
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
