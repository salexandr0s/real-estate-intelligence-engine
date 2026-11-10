import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  listings,
  listingVersions,
  query,
  runMigrations,
  savedListings,
  transaction,
} from '@immoradar/db';
import { Immoscout24Mapper } from '@immoradar/normalization';
import { NormalizeAndUpsert } from '@immoradar/ingestion';
import { buildApp } from '../../apps/api/src/app.js';
import { seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({ namePrefix: 'immoradar_test_projects', enabled: true });
const auth = { authorization: 'Bearer dev-token' };
let sourceId: number;
let runId: number;
let app: FastifyInstance;

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  await seed();
  sourceId = Number(
    (await query<{ id: string }>("SELECT id FROM sources WHERE code = 'immoscout24'"))[0]!.id,
  );
  runId = Number(
    (
      await query<{ id: string }>(
        "INSERT INTO scrape_runs(source_id, trigger_type, scope) VALUES ($1, 'manual', 'full') RETURNING id",
        [sourceId],
      )
    )[0]!.id,
  );
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await testDb.teardown();
});

async function rawRow(key: string, payload: Record<string, unknown>): Promise<number> {
  const [raw] = await query<{ id: string }>(
    `INSERT INTO raw_listings (source_id, source_listing_key, canonical_url, detail_url,
       content_sha256, first_scrape_run_id, last_scrape_run_id, extraction_status, raw_payload)
     VALUES ($1, $2, $3, $3, $4, $5, $5, 'captured', $6) RETURNING id`,
    [
      sourceId,
      key,
      `https://example.com/${key}`,
      key.padEnd(64, '0'),
      runId,
      JSON.stringify(payload),
    ],
  );
  return Number(raw!.id);
}

describe('project migration and API', () => {
  it('backfills legacy and typed raw fields safely and preserves raw data and history', async () => {
    await query('ALTER TABLE listings DROP COLUMN is_project, DROP COLUMN price_from_eur_cents');
    await query("DELETE FROM _migrations WHERE filename = '031-listings-project-price-from.sql'");
    const cases = [
      {
        key: 'legacy-project',
        raw: { estateTypeRaw: 'APARTMENT', attributesRaw: { priceFromRaw: '389000.50' } },
        project: true,
        cents: 38_900_050,
      },
      {
        key: 'legacy-unknown',
        raw: { attributesRaw: { priceFromRaw: '389000' } },
        project: false,
        cents: 38_900_000,
      },
      {
        key: 'legacy-flat',
        raw: { estateTypeRaw: 'APARTMENT', priceRaw: '389000' },
        project: false,
        cents: null,
      },
      {
        key: 'invalid',
        raw: { estateTypeRaw: 'APARTMENT', attributesRaw: { priceFromRaw: 'auf Anfrage' } },
        project: true,
        cents: null,
      },
      {
        key: 'overflow',
        raw: {
          estateTypeRaw: 'APARTMENT',
          attributesRaw: { priceFromRaw: '999999999999999999999999' },
        },
        project: true,
        cents: null,
      },
      { key: 'typed-missing', raw: { isProjectRaw: true }, project: true, cents: null },
      {
        key: 'typed-project',
        raw: { isProjectRaw: true, priceFromRaw: '419000' },
        project: true,
        cents: 41_900_000,
      },
      {
        key: 'typed-flat',
        raw: {
          isProjectRaw: false,
          estateTypeRaw: 'APARTMENT',
          attributesRaw: { priceFromRaw: '389000' },
        },
        project: false,
        cents: 38_900_000,
      },
    ];
    for (const c of cases) {
      const rawId = await rawRow(c.key, c.raw);
      const [listing] = await query<{ id: string }>(
        `INSERT INTO listings(source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
          canonical_url, operation_type, property_type, listing_status, title, city,
          content_fingerprint, current_score, last_scored_at)
         VALUES ($1, $2, $3, $4, $5, 'sale', 'apartment', 'active', 'Fixture', 'Wien', $6, 43, NOW()) RETURNING id`,
        [sourceId, c.key, rawId, runId, `https://example.com/${c.key}`, 'a'.repeat(64)],
      );
      await listingVersions.appendVersion({
        listingId: Number(listing!.id),
        rawListingId: rawId,
        versionReason: 'first_seen',
        listingStatus: 'active',
        contentFingerprint: 'a'.repeat(64),
        normalizedSnapshot: { legacy: true },
      });
    }
    const historyBefore = await query('SELECT * FROM listing_versions ORDER BY id');
    const rawBefore = await query('SELECT id, raw_payload FROM raw_listings ORDER BY id');
    await runMigrations();
    for (const c of cases) {
      const listing = await listings.findBySourceKey(sourceId, c.key);
      expect(listing).toMatchObject({
        isProject: c.project,
        priceFromEurCents: c.cents,
        currentScore: c.project ? null : 43,
      });
      if (c.project) expect(listing!.lastScoredAt).toBeNull();
    }
    expect(await query('SELECT * FROM listing_versions ORDER BY id')).toEqual(historyBefore);
    expect(await query('SELECT id, raw_payload FROM raw_listings ORDER BY id')).toEqual(rawBefore);
    await runMigrations();
    // Also test the SQL's own guard: rerunning it cannot undo later normalization.
    await query(
      "UPDATE listings SET price_from_eur_cents = 42000000 WHERE source_listing_key = 'legacy-project'",
    );
    await transaction(async (client) => {
      await client.query(
        readFileSync('packages/db/migrations/031-listings-project-price-from.sql', 'utf8'),
      );
    });
    expect((await listings.findBySourceKey(sourceId, 'legacy-project'))!.priceFromEurCents).toBe(
      42_000_000,
    );
  });

  it('persists and returns project prices separately, with idempotent replay and score protection', async () => {
    const payload = {
      titleRaw: 'Projekt Wien',
      isProjectRaw: true,
      priceFromRaw: '389000.50',
      postalCodeRaw: '1150',
      cityRaw: 'Wien',
      estateTypeRaw: 'APARTMENT',
      operationTypeRaw: 'sale',
    };
    const rawId = await rawRow('normalized-project', payload);
    const normalizer = new NormalizeAndUpsert(new Map([['immoscout24', new Immoscout24Mapper()]]), {
      findExistingListing: listings.findBySourceKey,
      upsertListing: async (input) => {
        const previous = await listings.findBySourceKey(input.sourceId, input.sourceListingKey);
        const row = await listings.upsertListing(input);
        return { id: row.id, isNew: previous === null };
      },
      updateLifecycleStatus: listings.updateLifecycleStatus,
      appendListingVersion: (input) =>
        listingVersions.appendVersion({ ...input, listingStatus: 'active' }),
      updateScrapeRunNormalizationCounts: async () => {},
    });
    const context = {
      sourceId,
      sourceListingKey: 'normalized-project',
      rawListingId: rawId,
      scrapeRunId: runId,
      canonicalUrl: 'https://example.com/normalized-project',
      detailUrl: 'https://example.com/normalized-project',
    };
    const first = await normalizer.process('immoscout24', payload, context, runId);
    const second = await normalizer.process('immoscout24', payload, context, runId);
    expect(second.listingId).toBe(first.listingId);
    expect(second.listingVersionId).toBeNull();
    expect(await listingVersions.findByListingId(first.listingId)).toHaveLength(1);
    expect(await listings.updateScore(first.listingId, 44, new Date())).toBeNull();

    const expected = {
      isProject: true,
      priceFromEur: 389000.5,
      priceFromEurCents: 38_900_050,
      listPriceEur: null,
      currentScore: null,
    };
    const detail = await app.inject({ url: `/v1/listings/${first.listingId}`, headers: auth });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ data: unknown }>().data).toMatchObject(expected);
    const search = await app.inject({ url: '/v1/listings?sortBy=newest', headers: auth });
    expect(
      search.json<{ data: Array<{ id: number }> }>().data.find((l) => l.id === first.listingId),
    ).toMatchObject(expected);
    const owner = Number(
      (await query<{ id: string }>('SELECT id FROM app_users ORDER BY id LIMIT 1'))[0]!.id,
    );
    await savedListings.save(owner, first.listingId);
    const saved = await app.inject({ url: '/v1/saved-listings', headers: auth });
    expect(saved.json<{ data: Array<{ listing: unknown }> }>().data[0]!.listing).toMatchObject(
      expected,
    );
    expect(
      (
        await app.inject({
          url: `/v1/listings/${first.listingId}/score-explanation`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await listings.searchListings({ minPriceEurCents: 1 }, null, 100)).data.some(
        (l) => l.id === first.listingId,
      ),
    ).toBe(false);
    const csv = await listings.exportListingsCsv({});
    expect(csv.csv.split('\n')[0]).toContain('is_project,price_from_eur');
    expect(csv.csv.split('\n').find((line) => line.startsWith(`${first.listingId},`))).toContain(
      'true,389000.50',
    );
  });
});
