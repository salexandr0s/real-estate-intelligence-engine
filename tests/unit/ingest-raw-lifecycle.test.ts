import { describe, expect, it, vi } from 'vitest';
import { IngestRawListing } from '../../packages/ingestion/src/ingest-raw.ts';

describe('IngestRawListing lifecycle metadata', () => {
  it('maps not_found availability into raw lifecycle fields', async () => {
    let capturedInput: Record<string, unknown> | null = null;

    const ingestor = new IngestRawListing({
      upsertRawSnapshot: vi.fn(async (input) => {
        capturedInput = input as unknown as Record<string, unknown>;
        return { id: 42, isNew: true };
      }),
      updateScrapeRunMetrics: vi.fn(async () => {}),
      computeContentHash: vi.fn(() => 'a'.repeat(64)),
    });

    await ingestor.ingest(
      {
        sourceCode: 'immoscout24',
        sourceListingKeyCandidate: 'immoscout24:abc123',
        externalId: 'abc123',
        canonicalUrl: 'https://example.com/expose/abc123',
        detailUrl: 'https://example.com/expose/abc123',
        extractedAt: new Date().toISOString(),
        payload: { titleRaw: null },
        parserVersion: 2,
        extractionStatus: 'parse_failed',
        availabilityStatus: 'not_found',
      },
      7,
      99,
    );

    expect(capturedInput).toMatchObject({
      extractionStatus: 'not_found',
      isDeletedAtSource: true,
      meta: {
        availabilityStatus: 'not_found',
        lifecycleEvidenceSource: 'adapter.detectAvailability',
      },
    });
  });
});
