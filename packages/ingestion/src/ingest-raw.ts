import type { DetailCapture, RawListingUpsert, ScrapeRunMetrics } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';

const log = createLogger('ingestion:raw');

/**
 * Handles the first stage of ingestion:
 * 1. Computes content hash from the detail capture payload
 * 2. Constructs a RawListingUpsert
 * 3. Persists to raw_listings (idempotent via source_id + source_listing_key + content_sha256)
 * 4. Updates scrape run metrics
 *
 * Returns the raw listing ID and whether it was a new snapshot or re-observation.
 */
export interface IngestRawResult {
  rawListingId: number;
  isNewSnapshot: boolean;
  sourceListingKey: string;
  contentSha256: string;
}

export interface RawIngestionDeps {
  upsertRawSnapshot: (input: RawListingUpsert) => Promise<{ id: number; isNew: boolean }>;
  updateScrapeRunMetrics: (runId: number, metrics: Partial<ScrapeRunMetrics>) => Promise<void>;
  computeContentHash: (payload: Record<string, unknown>) => string;
}

export class IngestRawListing {
  constructor(private readonly deps: RawIngestionDeps) {}

  async ingest<T>(
    capture: DetailCapture<T>,
    sourceId: number,
    scrapeRunId: number,
  ): Promise<IngestRawResult> {
    const sourceListingKey =
      capture.sourceListingKeyCandidate ?? this.deriveKeyFromUrl(capture.canonicalUrl);

    const contentSha256 = this.deps.computeContentHash(
      capture.payload as unknown as Record<string, unknown>,
    );

    const upsertInput: RawListingUpsert = {
      sourceId,
      sourceListingKey,
      externalId: capture.externalId ?? null,
      canonicalUrl: capture.canonicalUrl,
      detailUrl: capture.detailUrl,
      discoveryUrl: capture.discoveryUrl ?? null,
      payloadFormat: 'json',
      extractionStatus: capture.extractionStatus,
      responseStatus: capture.responseStatus ?? null,
      responseHeaders: capture.responseHeaders ?? {},
      rawPayload: capture.payload as unknown as Record<string, unknown>,
      bodyStorageKey: capture.htmlStorageKey ?? null,
      screenshotStorageKey: capture.screenshotStorageKey ?? null,
      harStorageKey: capture.harStorageKey ?? null,
      contentSha256,
      parserVersion: capture.parserVersion,
      scrapeRunId,
    };

    log.info('Upserting raw snapshot', {
      sourceCode: capture.sourceCode,
      sourceListingKey,
      scrapeRunId,
    });

    const { id: rawListingId, isNew } = await this.deps.upsertRawSnapshot(upsertInput);

    const metricsDelta: Partial<ScrapeRunMetrics> = {};
    if (isNew) {
      metricsDelta.rawSnapshotsCreated = 1;
    }

    await this.deps.updateScrapeRunMetrics(scrapeRunId, metricsDelta);

    log.info('Raw snapshot persisted', {
      rawListingId,
      isNewSnapshot: isNew,
      sourceListingKey,
    });

    return {
      rawListingId,
      isNewSnapshot: isNew,
      sourceListingKey,
      contentSha256,
    };
  }

  private deriveKeyFromUrl(url: string): string {
    // Fallback key derivation from URL path
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? parsed.pathname;
  }
}
