import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations, query, marketBaselines } from '@immoradar/db';
import { DEFAULT_SOURCE_SEEDS, seed } from '../../packages/db/seeds/seed.js';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_migrations',
  enabled: true,
});

beforeAll(async () => {
  await testDb.setup();
});

afterAll(async () => {
  await testDb.teardown();
});

describe('migration quality', () => {
  describe('migrations from empty database', () => {
    it('runs all migrations without error', async () => {
      await expect(runMigrations()).resolves.toBeUndefined();
    });

    it('creates expected core tables', async () => {
      const result = await query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      const tables = result.map((r) => r.tablename);

      const expectedTables = [
        '_migrations',
        'alerts',
        'app_users',
        'listing_scores',
        'listing_versions',
        'listings',
        'market_baselines',
        'raw_listings',
        'scrape_runs',
        'sources',
        'user_filters',
      ];

      for (const table of expectedTables) {
        expect(tables).toContain(table);
      }
    });

    it('records migration checksums', async () => {
      const rows = await query<{ filename: string; checksum: string }>(
        'SELECT filename, checksum FROM _migrations ORDER BY filename',
      );

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.filename).toMatch(/^\d{3}-.+\.sql$/);
        expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('is idempotent (running again applies nothing)', async () => {
      const before = await query<{ filename: string }>(
        'SELECT filename FROM _migrations ORDER BY filename',
      );

      await runMigrations();

      const after = await query<{ filename: string }>(
        'SELECT filename FROM _migrations ORDER BY filename',
      );

      expect(after).toEqual(before);
    });
  });

  describe('seed on migrated database', () => {
    it('seeds default user and sources', async () => {
      await seed();

      const users = await query<{ count: string }>('SELECT count(*)::text AS count FROM app_users');
      expect(Number(users[0]?.count)).toBe(1);

      const sources = await query<{ count: string }>('SELECT count(*)::text AS count FROM sources');
      expect(Number(sources[0]?.count)).toBe(DEFAULT_SOURCE_SEEDS.length);
    });

    it('is idempotent (running again does not duplicate)', async () => {
      await seed();

      const users = await query<{ count: string }>('SELECT count(*)::text AS count FROM app_users');
      expect(Number(users[0]?.count)).toBe(1);

      const sources = await query<{ count: string }>('SELECT count(*)::text AS count FROM sources');
      expect(Number(sources[0]?.count)).toBe(DEFAULT_SOURCE_SEEDS.length);
    });
  });

  describe('market baselines on migrated database', () => {
    // A city-wide row has a NULL district_no. While the unique key treated NULLs as distinct,
    // every baseline run inserted another copy of it instead of updating it.
    it('updates the city-wide and district rows in place when a run is written twice', async () => {
      const baselineDate = new Date(2000, 0, 1);
      const cityWide = {
        city: 'Wien',
        districtNo: null,
        operationType: 'sale',
        propertyType: 'apartment',
        areaBucket: 'all',
        roomBucket: 'all',
        sampleSize: 10,
        medianPpsqmEur: 5000,
      };
      const district = { ...cityWide, districtNo: 3, sampleSize: 4, medianPpsqmEur: 6000 };
      await marketBaselines.upsertBaselines(baselineDate, [cityWide, district]);
      const written = await marketBaselines.upsertBaselines(baselineDate, [
        { ...cityWide, sampleSize: 12, medianPpsqmEur: 5100 },
        { ...district, sampleSize: 5, medianPpsqmEur: 6100 },
      ]);

      const rows = await query<{
        district_no: number | null;
        sample_size: number;
        median_ppsqm_eur: string;
      }>(
        `SELECT district_no, sample_size, median_ppsqm_eur FROM market_baselines
         WHERE baseline_date = DATE '2000-01-01' ORDER BY district_no NULLS FIRST`,
      );
      expect(written).toBe(2);
      expect(rows).toEqual([
        { district_no: null, sample_size: 12, median_ppsqm_eur: '5100.00' },
        { district_no: 3, sample_size: 5, median_ppsqm_eur: '6100.00' },
      ]);
    });
  });
});
