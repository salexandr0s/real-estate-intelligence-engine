import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documents, listings, query, runMigrations } from '@immoradar/db';
import type { CanonicalListingInput } from '@immoradar/contracts';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_geocoding_documents',
  enabled: true,
});

let sourceId: number;
let scrapeRunId: number;
let rawNo = 0;

/** An active Vienna listing without coordinates, as ingestion writes it. */
async function listingInput(key: string): Promise<CanonicalListingInput> {
  const raw = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id, extraction_status,
       first_seen_at, last_seen_at, observed_at
     ) VALUES ($1, $2, $3, $3, $4, $5, $5, 'captured', NOW(), NOW(), NOW())
     RETURNING id`,
    [sourceId, key, `https://example.com/${key}`, String(++rawNo).padStart(64, '0'), scrapeRunId],
  );
  return {
    sourceId,
    sourceListingKey: key,
    currentRawListingId: Number(raw[0]!.id),
    latestScrapeRunId: scrapeRunId,
    canonicalUrl: `https://example.com/${key}`,
    operationType: 'sale',
    propertyType: 'apartment',
    listingStatus: 'active',
    title: 'Fixture',
    city: 'Wien',
    postalCode: '1060',
    normalizedPayload: {},
    completenessScore: 50,
    contentFingerprint: 'b'.repeat(64),
    normalizationVersion: 1,
  };
}

const dueIds = async () =>
  (await listings.findListingsNeedingGeocoding(10)).map((listing) => listing.id);

async function backoff(id: number) {
  const rows = await query<{ geocode_attempts: number; days: string | null }>(
    `SELECT geocode_attempts,
            ROUND(EXTRACT(EPOCH FROM geocode_next_attempt_at - NOW()) / 86400)::text AS days
     FROM listings WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  await seed();
  const source = await query<{ id: string }>(`SELECT id FROM sources ORDER BY id LIMIT 1`);
  sourceId = Number(source[0]!.id);
  const run = await query<{ id: string }>(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope)
     VALUES ($1, 'manual', 'full') RETURNING id`,
    [sourceId],
  );
  scrapeRunId = Number(run[0]!.id);
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(async () => {
  await query('DELETE FROM listing_documents');
  await query('DELETE FROM listings');
  await query('DELETE FROM raw_listings');
});

describe('geocoding backoff', () => {
  it('waits 1, 2, 4 and 8 days between attempts and stops after the fifth', async () => {
    const { id } = await listings.upsertListing(await listingInput('never-geocodes'));
    const waits: Array<string | null> = [];

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await dueIds()).toEqual([id]);
      expect(await listings.markGeocodeAttempts([id])).toEqual([id]);
      // A run that read the listing before this mark finds nothing left to count.
      expect(await listings.markGeocodeAttempts([id])).toEqual([]);
      expect(await dueIds()).toEqual([]);

      const state = await backoff(id);
      expect(state.geocode_attempts).toBe(attempt);
      waits.push(state.days);
      await query(
        `UPDATE listings SET geocode_next_attempt_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [id],
      );
    }

    expect(waits).toEqual(['1', '2', '4', '8', '16']);
    expect(await dueIds()).toEqual([]);
  });

  it('tries again after a new address, and not after the same one', async () => {
    const input = await listingInput('gains-a-street');
    const { id } = await listings.upsertListing(input);
    await query(`UPDATE listings SET geocode_attempts = 5 WHERE id = $1`, [id]);

    await listings.upsertListing(input);
    expect(await dueIds()).toEqual([]);

    await listings.upsertListing({ ...input, street: 'Mariahilfer Straße', houseNumber: '12' });
    expect(await dueIds()).toEqual([id]);
    expect(await backoff(id)).toEqual({ geocode_attempts: 0, days: null });
  });

  it("stores the 'estimated' precision the geocoder writes for a midpoint", async () => {
    const { id } = await listings.upsertListing(await listingInput('midpoint'));
    await listings.updateCoordinates(id, 48.2, 16.35, 'estimated', 'nlp_nominatim');
    expect((await listings.findById(id))?.geocodePrecision).toBe('estimated');
  });
});

describe('listing documents', () => {
  const url = 'https://example.com/expose.pdf';

  async function failedDocument(key: string, checksum: string | null = null) {
    const { id: listingId } = await listings.upsertListing(await listingInput(key));
    const doc = await documents.upsertDocument({ listingId, url, checksum });
    const failed = await documents.updateStatus(doc.id, 'failed', {
      lastErrorCode: 'download_http_error',
      lastErrorMessage: 'HTTP 404',
    });
    return { listingId, doc, failed };
  }

  it('records a download failure and clears it on a later success', async () => {
    const { doc, failed } = await failedDocument('failure-then-success');
    expect(failed).toMatchObject({
      status: 'failed',
      lastErrorCode: 'download_http_error',
      lastErrorMessage: 'HTTP 404',
    });

    const downloaded = await documents.updateStatus(doc.id, 'downloaded', {
      checksum: 'c'.repeat(64),
      clearFailure: true,
    });
    expect(downloaded).toMatchObject({
      status: 'downloaded',
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  });

  it('keeps a failed document failed when a capture lists it again', async () => {
    // Captures find a document by URL, and a backfill by checksum.
    for (const [key, checksum] of [
      ['by-url', null],
      ['by-checksum', 'd'.repeat(64)],
    ] as const) {
      const { listingId, doc } = await failedDocument(key, checksum);
      const again = await documents.upsertDocument({ listingId, url, checksum });
      expect(again).toMatchObject({ id: doc.id, status: 'failed' });
    }
  });
});
