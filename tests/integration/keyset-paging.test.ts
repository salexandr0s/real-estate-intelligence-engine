import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SortBy } from '@immoradar/contracts';
import { alerts, listings, query, runMigrations } from '@immoradar/db';
import type { AlertSortBy, AlertSortDirection } from '@immoradar/db';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_keyset_paging',
  enabled: true,
});

let sourceId: number;
let runId: number;
let fixtureNo = 0;

async function insertListing(
  priceCents: number | null,
  firstSeenAt: string,
  place: { city?: string; districtName?: string } = {},
): Promise<number> {
  const key = `paging-${++fixtureNo}`;
  const raw = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id, extraction_status
     ) VALUES ($1, $2, $3, $3, $4, $5, $5, 'captured')
     RETURNING id`,
    [sourceId, key, `https://example.com/${key}`, String(fixtureNo).padStart(64, '0'), runId],
  );
  const rows = await query<{ id: string }>(
    `INSERT INTO listings (
       source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
       canonical_url, operation_type, property_type, listing_status, title, city, district_name,
       content_fingerprint, district_no, list_price_eur_cents, first_seen_at
     ) VALUES ($1, $2, $3, $4, $5, 'sale', 'apartment', 'active', 'Fixture', $9, $10, $6, 2, $7, $8)
     RETURNING id`,
    [
      sourceId,
      key,
      raw[0]!.id,
      runId,
      `https://example.com/${key}`,
      'p'.repeat(64),
      priceCents,
      firstSeenAt,
      place.city ?? 'Wien',
      place.districtName ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function pageAllAlerts(
  userId: number,
  sortBy: AlertSortBy,
  sortDirection: AlertSortDirection,
): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  do {
    const page = await alerts.findByUser(userId, null, cursor, 1, { sortBy, sortDirection });
    ids.push(...page.data.map((a) => a.id));
    cursor = page.nextCursor;
    // A cursor that leads back to the first page would loop forever.
    if (ids.length > 50) throw new Error(`Alert paging did not end: ${sortBy} ${sortDirection}`);
  } while (cursor);
  return ids;
}

async function pageAllListings(sortBy: SortBy): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  do {
    const page = await listings.searchListings({ sortBy }, cursor, 2);
    ids.push(...page.data.map((l) => l.id));
    cursor = page.meta.nextCursor;
  } while (cursor);
  return ids;
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  const source = await query<{ id: string }>(
    `INSERT INTO sources (code, name, base_url) VALUES ('paging', 'paging', 'https://paging.example.com')
     RETURNING id`,
  );
  sourceId = Number(source[0]!.id);
  const run = await query<{ id: string }>(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope) VALUES ($1, 'manual', 'full')
     RETURNING id`,
    [sourceId],
  );
  runId = Number(run[0]!.id);
});

afterAll(async () => {
  await testDb.teardown();
});

describe('listing search keyset paging', () => {
  it('returns every listing once, those without a price included, in each price order', async () => {
    const ids = [
      await insertListing(100_000_00, '2026-11-01T10:00:00.000100Z'),
      await insertListing(null, '2026-11-01T10:00:00.000200Z'),
      await insertListing(200_000_00, '2026-11-01T10:00:00.000300Z'),
      await insertListing(null, '2026-11-01T10:00:00.000400Z'),
      await insertListing(200_000_00, '2026-11-01T10:00:00.000500Z'),
    ];

    for (const sortBy of ['price_asc', 'price_desc', 'newest'] as const) {
      const paged = await pageAllListings(sortBy);
      expect(paged, sortBy).toHaveLength(ids.length);
      expect(
        [...paged].sort((a, b) => a - b),
        sortBy,
      ).toEqual(ids);
    }

    // The listings without a price come last, after the cursor leaves the priced rows.
    const priceAsc = await pageAllListings('price_asc');
    expect(priceAsc.slice(-2)).toEqual([ids[3], ids[1]]);
  });
});

describe('alert list', () => {
  it('lists each inbox alert once and leaves out the copies for other channels', async () => {
    const listingId = await insertListing(150_000_00, '2026-11-02T10:00:00Z');
    const user = await query<{ id: string }>(
      `INSERT INTO app_users (display_name) VALUES ('Investor') RETURNING id`,
    );
    const userId = Number(user[0]!.id);
    const filter = await query<{ id: string }>(
      `INSERT INTO user_filters (user_id, name, alert_channels)
       VALUES ($1, 'Leopoldstadt', ARRAY['in_app', 'push']) RETURNING id`,
      [userId],
    );
    const userFilterId = Number(filter[0]!.id);

    const inbox: number[] = [];
    for (let i = 0; i < 3; i++) {
      const dedupeKey = `filter:${userFilterId}:listing:${listingId}:type:new_match:n:${i}`;
      for (const channel of ['in_app', 'push'] as const) {
        const alert = await alerts.create({
          userId,
          userFilterId,
          listingId,
          alertType: 'new_match',
          channel,
          dedupeKey,
          title: 'New match',
          body: 'Fixture',
        });
        // Microseconds apart inside one millisecond, as alerts created in one burst are.
        await query(`UPDATE alerts SET matched_at = $2, status = $3 WHERE id = $1`, [
          alert!.id,
          `2026-11-02T10:00:00.000${i + 1}00Z`,
          channel === 'push' ? 'sent' : 'queued',
        ]);
        if (channel === 'in_app') inbox.push(alert!.id);
      }
    }

    const orders: Array<[AlertSortBy, AlertSortDirection]> = [
      ['age', 'asc'],
      ['age', 'desc'],
      ['price', 'asc'],
      ['district', 'desc'],
    ];
    for (const [sortBy, sortDirection] of orders) {
      const seen = await pageAllAlerts(userId, sortBy, sortDirection);
      expect(
        [...seen].sort((a, b) => a - b),
        `${sortBy} ${sortDirection}`,
      ).toEqual(inbox);
    }

    expect(await alerts.countUnread(userId)).toBe(3);
    const otherFilter = await alerts.findByUser(userId, null, null, 25, {
      userFilterId: userFilterId + 1000,
    });
    expect(otherFilter.data).toHaveLength(0);
  });

  it('pages alerts without a district or price after the others, in both directions', async () => {
    const user = await query<{ id: string }>(
      `INSERT INTO app_users (display_name) VALUES ('Sorter') RETURNING id`,
    );
    const userId = Number(user[0]!.id);
    const filter = await query<{ id: string }>(
      `INSERT INTO user_filters (user_id, name, alert_channels)
       VALUES ($1, 'Everywhere', ARRAY['in_app']) RETURNING id`,
      [userId],
    );
    const userFilterId = Number(filter[0]!.id);

    // Under the C collation Ötztal sorts after every ASCII character, so a placeholder key
    // standing in for a missing district would sort before it.
    const fixtures: Array<[string, number | null, { city?: string; districtName?: string }]> = [
      ['leopoldstadt', 300_000_00, { districtName: 'Leopoldstadt' }],
      ['oetztal', null, { districtName: 'Ötztal' }],
      ['noPlace', 150_000_00, { city: '' }],
      ['graz', 250_000_00, { city: 'Graz' }],
      ['nothing', null, { city: '' }],
    ];
    const alertOf = new Map<string, number>();
    for (const [name, priceCents, place] of fixtures) {
      const listingId = await insertListing(priceCents, '2026-11-03T10:00:00Z', place);
      const alert = await alerts.create({
        userId,
        userFilterId,
        listingId,
        alertType: 'new_match',
        channel: 'in_app',
        dedupeKey: `filter:${userFilterId}:listing:${listingId}:type:new_match`,
        title: 'New match',
        body: 'Fixture',
      });
      alertOf.set(name, alert!.id);
    }
    const order = (...names: string[]) => names.map((name) => alertOf.get(name));

    // Rows without a key come last either way, in id order for the direction.
    const expected: Array<[AlertSortBy, AlertSortDirection, Array<number | undefined>]> = [
      ['district', 'asc', order('graz', 'leopoldstadt', 'oetztal', 'noPlace', 'nothing')],
      ['district', 'desc', order('oetztal', 'leopoldstadt', 'graz', 'nothing', 'noPlace')],
      ['price', 'asc', order('noPlace', 'graz', 'leopoldstadt', 'oetztal', 'nothing')],
      ['price', 'desc', order('leopoldstadt', 'graz', 'noPlace', 'nothing', 'oetztal')],
    ];
    for (const [sortBy, sortDirection, ids] of expected) {
      expect(
        await pageAllAlerts(userId, sortBy, sortDirection),
        `${sortBy} ${sortDirection}`,
      ).toEqual(ids);
    }
  });
});
