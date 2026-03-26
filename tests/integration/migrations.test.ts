import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations, query } from '@immoradar/db';
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
});
