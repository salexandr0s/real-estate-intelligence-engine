import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  listings,
  listingVersions,
  query,
  rawSightings,
  runMigrations,
  transaction,
} from '@immoradar/db';
import type { CanonicalListingInput } from '@immoradar/contracts';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const MIGRATION_024 = path.resolve(
  __dirname,
  '../../packages/db/migrations/024-raw-listing-sightings.sql',
);

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_sightings',
  enabled: true,
});

let sourceId: number;
let scrapeRunId: number;
let fixtureNo = 0;

async function insertRaw(key: string, extractionStatus = 'captured'): Promise<number> {
  const rows = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id, extraction_status,
       first_seen_at, last_seen_at, observed_at
     ) VALUES (
       $1, $2, $3, $3, $4, $5, $5, $6,
       NOW() - INTERVAL '180 days', NOW() - INTERVAL '180 days', NOW() - INTERVAL '180 days'
     )
     RETURNING id`,
    [
      sourceId,
      key,
      `https://example.com/${key}`,
      String(++fixtureNo).padStart(64, '0'),
      scrapeRunId,
      extractionStatus,
    ],
  );
  return Number(rows[0]!.id);
}

/** An active listing last observed long ago, as an import leaves it. */
async function insertOldListing(key: string, extractionStatus = 'captured') {
  const rawId = await insertRaw(key, extractionStatus);
  const rows = await query<{ id: string }>(
    `INSERT INTO listings (
       source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
       canonical_url, operation_type, property_type, title, city, content_fingerprint,
       first_seen_at, last_seen_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'sale', 'apartment', 'Fixture', 'Wien', $6,
       NOW() - INTERVAL '180 days', NOW() - INTERVAL '180 days'
     )
     RETURNING id`,
    [sourceId, key, rawId, scrapeRunId, `https://example.com/${key}`, 'b'.repeat(64)],
  );
  return { id: Number(rows[0]!.id), rawId };
}

async function rerunBackfill(): Promise<void> {
  const sql = fs.readFileSync(MIGRATION_024, 'utf8');
  await query('DELETE FROM raw_listing_sightings');
  await transaction(async (client) => {
    await client.query(sql);
  });
}

async function sighting(key: string) {
  const rows = await query<{
    last_detail_ok_at: Date | null;
    last_sighted_at: Date | null;
    inconclusive_count: number;
    next_detail_days: string | null;
    summary_changed_at: Date | null;
  }>(
    `SELECT last_detail_ok_at, last_sighted_at, inconclusive_count, summary_changed_at,
            ROUND(EXTRACT(EPOCH FROM next_detail_at - NOW()) / 86400)::text AS next_detail_days
     FROM raw_listing_sightings WHERE source_id = $1 AND source_listing_key = $2`,
    [sourceId, key],
  );
  return rows[0]!;
}

/** Three strikes spaced in the past, with the listing unseen since. */
async function giveThreeStrikes(key: string) {
  await query(
    `UPDATE raw_listing_sightings
     SET inconclusive_count = 3, last_inconclusive_at = NOW() - INTERVAL '1 day', last_sighted_at = NULL
     WHERE source_id = $1 AND source_listing_key = $2`,
    [sourceId, key],
  );
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  await seed();
  const source = await query<{ id: string }>(`SELECT id FROM sources ORDER BY id LIMIT 1`);
  sourceId = Number(source[0]!.id);
  await query(`UPDATE sources SET is_active = TRUE, health_status = 'healthy' WHERE id = $1`, [
    sourceId,
  ]);
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
  await query('DELETE FROM listing_versions');
  await query('DELETE FROM listings');
  await query('DELETE FROM raw_listing_sightings');
  await query('DELETE FROM raw_listings');
});

describe('imported rows', () => {
  it('backfills without starting any listing toward expiry', async () => {
    await insertOldListing('good');
    // Wohnnet's anti-bot regex marked good captures as blocked, and they have listings.
    await insertOldListing('marked-blocked', 'blocked');
    await insertRaw('never-parsed', 'parse_failed');

    await rerunBackfill();

    const good = await sighting('good');
    expect(good.last_detail_ok_at).not.toBeNull();
    expect(good.last_sighted_at).toBeNull();
    expect(good.inconclusive_count).toBe(0);
    expect((await sighting('marked-blocked')).last_detail_ok_at).not.toBeNull();
    expect((await sighting('never-parsed')).last_detail_ok_at).toBeNull();

    expect(await listings.findExpiryCandidates(7)).toEqual([]);
  });

  it('does not count the first sweep after an import as a changed summary', async () => {
    await insertOldListing('imported');
    await rerunBackfill();
    const page = {
      sourceListingKey: 'imported',
      detailUrl: 'https://example.com/imported',
      discoveryUrl: null,
    };

    await rawSightings.upsertPage(sourceId, scrapeRunId, [
      { ...page, summarySha256: 'a'.repeat(64) },
      // A page can list a key twice, which one INSERT can't apply.
      { ...page, summarySha256: 'a'.repeat(64) },
    ]);
    expect((await sighting('imported')).summary_changed_at).toBeNull();

    await rawSightings.upsertPage(sourceId, scrapeRunId, [
      { ...page, summarySha256: 'c'.repeat(64) },
    ]);
    expect((await sighting('imported')).summary_changed_at).not.toBeNull();
  });
});

describe('expiry candidates', () => {
  beforeEach(async () => {
    await insertOldListing('gone');
    await insertOldListing('other-page');
    await rerunBackfill();
    await giveThreeStrikes('gone');
  });

  async function markOtherPage(outcome: 'parsed' | 'gone') {
    await rawSightings.recordDetailOutcome({
      sourceId,
      sourceListingKey: 'other-page',
      detailUrl: 'https://example.com/other-page',
      outcome,
      fetchedAt: new Date(),
    });
  }
  const markOtherPageParsed = () => markOtherPage('parsed');

  it('needs another page on the source to have parsed after the last strike', async () => {
    // The strike is newer than every good page, as during a site redesign.
    expect(await listings.findExpiryCandidates(7)).toEqual([]);

    await markOtherPageParsed();

    const candidates = await listings.findExpiryCandidates(7);
    expect(candidates.map((c) => c.sourceListingKey)).toEqual(['gone']);
  });

  it('does not take a page that said its listing is gone as proof the parser works', async () => {
    await markOtherPage('gone');
    expect(await listings.findExpiryCandidates(7)).toEqual([]);
  });

  it('skips a source that is not healthy', async () => {
    await markOtherPageParsed();
    await query(`UPDATE sources SET health_status = 'degraded' WHERE id = $1`, [sourceId]);
    try {
      expect(await listings.findExpiryCandidates(7)).toEqual([]);
    } finally {
      await query(`UPDATE sources SET health_status = 'healthy' WHERE id = $1`, [sourceId]);
    }
  });

  it('skips a listing discovery saw recently', async () => {
    await markOtherPageParsed();
    await rawSightings.upsertPage(sourceId, scrapeRunId, [
      {
        sourceListingKey: 'gone',
        detailUrl: 'https://example.com/gone',
        discoveryUrl: null,
        summarySha256: 'a'.repeat(64),
      },
    ]);

    expect(await listings.reconcileLastSeen()).toBe(1);
    expect(await listings.findExpiryCandidates(7)).toEqual([]);
  });

  async function goneListing() {
    const [row] = await query<{ id: string; current_raw_listing_id: string; last_seen_at: Date }>(
      `SELECT id, current_raw_listing_id, last_seen_at FROM listings WHERE source_listing_key = 'gone'`,
    );
    const id = Number(row!.id);
    const rawListingId = Number(row!.current_raw_listing_id);
    const expiry = (version: Partial<listingVersions.AppendVersionInput> = {}) =>
      listings.expireStale({
        thresholdDays: 7,
        sourceStatusRaw: 'expired_revalidation_failed',
        version: {
          listingId: id,
          rawListingId,
          listingStatus: 'expired',
          versionReason: 'status_change',
          contentFingerprint: 'd'.repeat(64),
          normalizedSnapshot: {},
          ...version,
        },
      });
    const state = async () => {
      const [listing] = await query<{
        listing_status: string;
        current_raw_listing_id: string;
        last_seen_at: Date;
      }>(
        `SELECT listing_status, current_raw_listing_id, last_seen_at FROM listings WHERE id = $1`,
        [id],
      );
      const versions = await query<{ version_no: number; raw_listing_id: string }>(
        `SELECT version_no, raw_listing_id FROM listing_versions WHERE listing_id = $1 ORDER BY version_no`,
        [id],
      );
      return { listing: listing!, versions };
    };
    return { id, rawListingId, lastSeenAt: row!.last_seen_at, expiry, state };
  }

  it('expires on the existing raw row with its version, and leaves last_seen_at alone', async () => {
    await markOtherPageParsed();
    const gone = await goneListing();
    await listingVersions.appendVersion({
      listingId: gone.id,
      rawListingId: gone.rawListingId,
      listingStatus: 'active',
      versionReason: 'first_seen',
      contentFingerprint: 'b'.repeat(64),
      normalizedSnapshot: {},
    });

    expect(await gone.expiry()).toBe(true);

    const { listing, versions } = await gone.state();
    expect(listing.listing_status).toBe('expired');
    expect(Number(listing.current_raw_listing_id)).toBe(gone.rawListingId);
    expect(listing.last_seen_at).toEqual(gone.lastSeenAt);
    // The same raw row backs a second version once migration 023 has dropped the unique index.
    expect(versions.map((v) => [v.version_no, Number(v.raw_listing_id)])).toEqual([
      [1, gone.rawListingId],
      [2, gone.rawListingId],
    ]);

    expect(await gone.expiry()).toBe(false);
  });

  it('checks the evidence again and keeps the status when the version fails', async () => {
    await markOtherPageParsed();
    const gone = await goneListing();

    // A version that can't be written takes the status change with it.
    await expect(gone.expiry({ rawListingId: 999_999_999 })).rejects.toThrow();
    expect((await gone.state()).listing.listing_status).toBe('active');

    // The listing's own page parsed after the candidates were read.
    await rawSightings.recordDetailOutcome({
      sourceId,
      sourceListingKey: 'gone',
      detailUrl: 'https://example.com/gone',
      outcome: 'parsed',
      fetchedAt: new Date(),
    });
    expect(await gone.expiry()).toBe(false);
    expect(await gone.state()).toMatchObject({
      listing: { listing_status: 'active' },
      versions: [],
    });
  });
});

describe('detail outcomes', () => {
  const key = 'flaky';
  let fetchNo = 0;
  const outcome = (o: 'parsed' | 'inconclusive', fetchedAt = new Date(Date.now() + ++fetchNo)) =>
    rawSightings.recordDetailOutcome({
      sourceId,
      sourceListingKey: key,
      detailUrl: `https://example.com/${key}`,
      outcome: o,
      fetchedAt,
    });

  it('spaces inconclusive fetches so three strikes span at least 6 days', async () => {
    await outcome('inconclusive');
    expect(await sighting(key)).toMatchObject({ inconclusive_count: 1, next_detail_days: '2' });
    await outcome('inconclusive');
    expect(await sighting(key)).toMatchObject({ inconclusive_count: 2, next_detail_days: '4' });
    await outcome('inconclusive');
    expect(await sighting(key)).toMatchObject({ inconclusive_count: 3, next_detail_days: '8' });
    await outcome('inconclusive');
    await outcome('inconclusive');
    expect(await sighting(key)).toMatchObject({ inconclusive_count: 5, next_detail_days: '30' });
  });

  it('clears the strikes on a good page', async () => {
    await outcome('inconclusive');
    await outcome('parsed');
    const row = await sighting(key);
    expect(row.inconclusive_count).toBe(0);
    expect(row.last_detail_ok_at).not.toBeNull();
  });

  // BullMQ can run a job twice, and jobs for one key can finish out of order.
  it('counts each fetch once, and a strike older than the last good page not at all', async () => {
    const strike = new Date(Date.now() - 60_000);
    await outcome('inconclusive', strike);
    await outcome('inconclusive', strike);
    expect((await sighting(key)).inconclusive_count).toBe(1);

    await outcome('parsed');
    await outcome('inconclusive', new Date(Date.now() - 30_000));
    expect((await sighting(key)).inconclusive_count).toBe(0);
  });
});

describe('detail selection', () => {
  const page = (key: string) => ({
    sourceListingKey: key,
    detailUrl: `https://example.com/${key}`,
    discoveryUrl: null,
    summarySha256: 'a'.repeat(64),
  });
  const select = (limit = 10) =>
    rawSightings.selectFresh({
      sourceId,
      scrapeRunId,
      refreshDays: 30,
      recheckInactiveDays: 7,
      limit,
    });

  async function setOk(key: string, daysAgo: number) {
    await query(
      `UPDATE raw_listing_sightings SET last_detail_ok_at = NOW() - make_interval(days => $3)
       WHERE source_id = $1 AND source_listing_key = $2`,
      [sourceId, key, daysAgo],
    );
  }

  it('takes new keys, then changed summaries, then the oldest, and skips recent ones', async () => {
    await rawSightings.upsertPage(sourceId, scrapeRunId, [
      page('recent'),
      page('old'),
      page('changed'),
      page('new'),
    ]);
    await setOk('recent', 1);
    await setOk('old', 40);
    await setOk('changed', 2);
    await rawSightings.upsertPage(sourceId, scrapeRunId, [
      { ...page('changed'), summarySha256: 'c'.repeat(64) },
    ]);

    const selected = await select();
    expect(selected.map((c) => c.sourceListingKey)).toEqual(['new', 'changed', 'old']);
  });

  it('holds an enqueued key back from the next sweep', async () => {
    await rawSightings.upsertPage(sourceId, scrapeRunId, [page('new')]);
    await rawSightings.markEnqueued(sourceId, ['new']);
    expect(await select()).toEqual([]);
  });

  it('revalidates active listings discovery has not seen, oldest first', async () => {
    await insertOldListing('oldest');
    await insertOldListing('older');
    await insertOldListing('sighted');
    await rerunBackfill();
    await rawSightings.upsertPage(sourceId, scrapeRunId, [page('sighted')]);
    await query(
      `UPDATE listings SET last_seen_at = NOW() - INTERVAL '100 days' WHERE source_listing_key = 'older'`,
    );

    const selected = await rawSightings.selectRevalidate(sourceId, 7, 10);
    expect(selected.map((c) => c.sourceListingKey)).toEqual(['oldest', 'older']);
  });
});

describe('upsertListing', () => {
  it('keeps stored coordinates when the source sends none', async () => {
    const rawId = await insertRaw('geocoded');
    const input: CanonicalListingInput = {
      sourceId,
      sourceListingKey: 'geocoded',
      currentRawListingId: rawId,
      latestScrapeRunId: scrapeRunId,
      canonicalUrl: 'https://example.com/geocoded',
      operationType: 'sale',
      propertyType: 'apartment',
      listingStatus: 'active',
      title: 'Fixture',
      city: 'Wien',
      normalizedPayload: {},
      completenessScore: 50,
      contentFingerprint: 'b'.repeat(64),
      normalizationVersion: 1,
    };
    const created = await listings.upsertListing(input);
    await listings.updateCoordinates(created.id, 48.2, 16.37, 'street', 'nominatim');

    const updated = await listings.upsertListing(input);
    expect(updated.latitude).toBe(48.2);
    expect(updated.longitude).toBe(16.37);
    expect(updated.geocodePrecision).toBe('street');
  });
});
