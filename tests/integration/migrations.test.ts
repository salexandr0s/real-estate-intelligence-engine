import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runMigrations, query, closePool } from '@immoradar/db';
import { seed } from '../../packages/db/seeds/seed.js';
import { resetConfig } from '@immoradar/config';

const TEST_DB_NAME = `immoradar_test_migrations_${process.pid}`;

let adminClient: pg.Client;
let originalDatabaseUrl: string | undefined;

beforeAll(async () => {
  // Save the original DATABASE_URL so we can restore it
  originalDatabaseUrl = process.env['DATABASE_URL'];

  // Connect to the default database to create the test database
  const adminUrl = originalDatabaseUrl ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  // Parse the URL and connect to the default 'postgres' database for admin operations
  const parsed = new URL(adminUrl);
  parsed.pathname = '/postgres';

  adminClient = new pg.Client({ connectionString: parsed.toString() });
  await adminClient.connect();

  // Create the test database
  await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
  await adminClient.query(`CREATE DATABASE "${TEST_DB_NAME}"`);

  // Point the app at the test database
  parsed.pathname = `/${TEST_DB_NAME}`;
  process.env['DATABASE_URL'] = parsed.toString();
  resetConfig();
});

afterAll(async () => {
  // Close the app pool so connections to the test DB are released
  await closePool();

  // Restore the original DATABASE_URL
  if (originalDatabaseUrl !== undefined) {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  } else {
    delete process.env['DATABASE_URL'];
  }
  resetConfig();

  // Terminate lingering connections then drop the test database
  await adminClient.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB_NAME],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
  await adminClient.end();
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
      expect(Number(sources[0]?.count)).toBe(7);
    });

    it('is idempotent (running again does not duplicate)', async () => {
      await seed();

      const users = await query<{ count: string }>('SELECT count(*)::text AS count FROM app_users');
      expect(Number(users[0]?.count)).toBe(1);

      const sources = await query<{ count: string }>('SELECT count(*)::text AS count FROM sources');
      expect(Number(sources[0]?.count)).toBe(7);
    });
  });
});
