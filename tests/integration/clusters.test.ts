import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alerts, clusters, query, runMigrations, transaction } from '@immoradar/db';
import { rebuildClusters } from '../../apps/worker-processing/src/workers/cluster-worker.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const MIGRATION_028 = path.resolve(
  __dirname,
  '../../packages/db/migrations/028-fingerprint-require-street.sql',
);

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_clusters',
  enabled: true,
});

interface FixtureSource {
  id: number;
  runId: number;
}

let sourceA: FixtureSource;
let sourceB: FixtureSource;
let fixtureNo = 0;

async function insertSource(code: string): Promise<FixtureSource> {
  const source = await query<{ id: string }>(
    `INSERT INTO sources (code, name, base_url) VALUES ($1, $1, $2) RETURNING id`,
    [code, `https://${code}.example.com`],
  );
  const run = await query<{ id: string }>(
    `INSERT INTO scrape_runs (source_id, trigger_type, scope)
     VALUES ($1, 'manual', 'full') RETURNING id`,
    [source[0]!.id],
  );
  return { id: Number(source[0]!.id), runId: Number(run[0]!.id) };
}

async function insertListing(
  source: FixtureSource,
  crossSourceFingerprint: string | null,
  street: string | null,
): Promise<number> {
  const key = `cluster-${++fixtureNo}`;
  const raw = await query<{ id: string }>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, canonical_url, detail_url, content_sha256,
       first_scrape_run_id, last_scrape_run_id, extraction_status
     ) VALUES ($1, $2, $3, $3, $4, $5, $5, 'captured')
     RETURNING id`,
    [
      source.id,
      key,
      `https://example.com/${key}`,
      String(fixtureNo).padStart(64, '0'),
      source.runId,
    ],
  );
  const rows = await query<{ id: string }>(
    `INSERT INTO listings (
       source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
       canonical_url, operation_type, property_type, title, city, content_fingerprint,
       cross_source_fingerprint, street
     ) VALUES ($1, $2, $3, $4, $5, 'sale', 'apartment', 'Fixture', 'Wien', $6, $7, $8)
     RETURNING id`,
    [
      source.id,
      key,
      raw[0]!.id,
      source.runId,
      `https://example.com/${key}`,
      'b'.repeat(64),
      crossSourceFingerprint,
      street,
    ],
  );
  return Number(rows[0]!.id);
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  sourceA = await insertSource('cluster-a');
  sourceB = await insertSource('cluster-b');
});

afterAll(async () => {
  await testDb.teardown();
});

describe('cluster rebuild', () => {
  it('deletes a cluster whose fingerprint no longer spans two sources, members included', async () => {
    const live = 'c1'.repeat(32);
    const stale = 'c2'.repeat(32);
    await insertListing(sourceA, live, 'Taborstraße');
    await insertListing(sourceB, live, 'Taborstraße');
    // Its match on the other source is gone, so the next rebuild doesn't produce this fingerprint.
    const leftover = await insertListing(sourceA, stale, 'Ring');
    const staleCluster = await clusters.upsertCluster(stale, [
      { listingId: leftover, sourceId: sourceA.id, listPriceEurCents: null },
    ]);

    await rebuildClusters();

    const remaining = await query<{ fingerprint: string }>(
      `SELECT fingerprint FROM listing_clusters WHERE fingerprint = ANY($1::text[])`,
      [[live, stale]],
    );
    expect(remaining.map((row) => row.fingerprint)).toEqual([live]);
    const staleMembers = await query(
      `SELECT 1 FROM listing_cluster_members WHERE cluster_id = $1`,
      [staleCluster.id],
    );
    expect(staleMembers).toHaveLength(0);
  });
});

describe('cluster alert suppression', () => {
  it('suppresses duplicates for 30 days after the cluster alert, not forever', async () => {
    const fingerprint = 'c3'.repeat(32);
    const listingId = await insertListing(sourceA, fingerprint, 'Taborstraße');
    const user = await query<{ id: string }>(
      `INSERT INTO app_users (display_name) VALUES ('Investor') RETURNING id`,
    );
    const filter = await query<{ id: string }>(
      `INSERT INTO user_filters (user_id, name) VALUES ($1, 'Leopoldstadt') RETURNING id`,
      [user[0]!.id],
    );
    const filterId = Number(filter[0]!.id);
    const alert = await alerts.create({
      userId: Number(user[0]!.id),
      userFilterId: filterId,
      listingId,
      alertType: 'new_match',
      channel: 'in_app',
      dedupeKey: `filter:${filterId}:listing:${listingId}:type:new_match`,
      title: 'New match',
      body: 'Taborstraße',
      clusterFingerprint: fingerprint,
    });
    const matchedDaysAgo = (days: number) =>
      query(`UPDATE alerts SET matched_at = NOW() - make_interval(days => $2) WHERE id = $1`, [
        alert!.id,
        days,
      ]);

    await matchedDaysAgo(29);
    expect(await alerts.existsForCluster(filterId, fingerprint, 'new_match')).toBe(true);

    await matchedDaysAgo(31);
    expect(await alerts.existsForCluster(filterId, fingerprint, 'new_match')).toBe(false);
  });
});

describe('migration 028', () => {
  it('clears fingerprints of listings without a street and keeps the rest', async () => {
    const withStreet = 'd3'.repeat(32);
    const ids = [
      await insertListing(sourceA, 'd1'.repeat(32), null),
      await insertListing(sourceA, 'd2'.repeat(32), '  '),
      await insertListing(sourceA, withStreet, 'Taborstraße'),
    ];

    await transaction(async (client) => {
      await client.query(fs.readFileSync(MIGRATION_028, 'utf8'));
    });

    const rows = await query<{ fingerprint: string | null }>(
      `SELECT cross_source_fingerprint AS fingerprint FROM listings
       WHERE id = ANY($1::bigint[]) ORDER BY id`,
      [ids],
    );
    expect(rows.map((row) => row.fingerprint)).toEqual([null, null, withStreet]);
  });
});
