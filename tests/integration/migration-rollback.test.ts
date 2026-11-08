import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runMigrations } from '@immoradar/db';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// One line per column, constraint, index, trigger, function and extension, so two databases
// can be compared as sets. Extension members and the runner's _migrations table are left out.
const SCHEMA_SNAPSHOT_SQL = `
  SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
    || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
    || COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
    || CASE WHEN a.attidentity <> '' THEN ' identity ' || a.attidentity::text ELSE '' END
    || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END AS item
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
    AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> '_migrations'
  UNION ALL
  SELECT 'constraint ' || c.relname || '.' || con.conname || ' ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname <> '_migrations'
  UNION ALL
  SELECT 'index ' || pg_get_indexdef(i.indexrelid)
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname <> '_migrations'
  UNION ALL
  SELECT 'trigger ' || pg_get_triggerdef(tg.oid)
  FROM pg_trigger tg
  JOIN pg_class t ON t.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND NOT tg.tgisinternal
  UNION ALL
  SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
    || md5(p.prosrc)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = p.oid AND dep.deptype = 'e')
  UNION ALL
  SELECT 'extension ' || extname FROM pg_extension WHERE extname <> 'plpgsql'
  ORDER BY 1
`;

async function describeSchema(connectionString: string, loadSql?: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (loadSql) await client.query(loadSql);
    const result = await client.query<{ item: string }>(SCHEMA_SNAPSHOT_SQL);
    return result.rows.map((row) => row.item);
  } finally {
    await client.end();
  }
}

const hasDb = !!process.env.DATABASE_URL;
const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_rollback',
  enabled: hasDb,
});

describe('migration rollback strategy', () => {
  // ── Lightweight file-based checks (always run) ─────────────────────────────

  describe('rollback documentation', () => {
    it('migration-rules.md exists', () => {
      const rulesPath = path.join(PROJECT_ROOT, 'docs', 'migration-rules.md');
      expect(fs.existsSync(rulesPath)).toBe(true);
    });

    it('migration-rules.md contains rollback guidance', () => {
      const rulesPath = path.join(PROJECT_ROOT, 'docs', 'migration-rules.md');
      const content = fs.readFileSync(rulesPath, 'utf-8');

      // Rule 8: "Document rollback strategy as a compensating migration"
      expect(content).toContain('rollback');
      expect(content).toContain('compensating migration');
    });

    it('migration-rules.md documents idempotency requirement', () => {
      const rulesPath = path.join(PROJECT_ROOT, 'docs', 'migration-rules.md');
      const content = fs.readFileSync(rulesPath, 'utf-8');

      expect(content).toContain('idempotent');
      expect(content).toContain('IF NOT EXISTS');
      expect(content).toContain('IF EXISTS');
    });
  });

  describe('schema idempotency guards', () => {
    it('schema.sql uses IF NOT EXISTS for CREATE TABLE statements', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'schema.sql');
      const content = fs.readFileSync(schemaPath, 'utf-8');

      // Extract all CREATE TABLE statements
      const createTableMatches = content.match(/CREATE\s+TABLE\b[^;]+/gi) ?? [];
      expect(createTableMatches.length).toBeGreaterThan(0);

      for (const stmt of createTableMatches) {
        expect(stmt.toUpperCase()).toContain('IF NOT EXISTS');
      }
    });

    it('schema.sql uses IF NOT EXISTS for CREATE INDEX statements', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'schema.sql');
      const content = fs.readFileSync(schemaPath, 'utf-8');

      // Extract all CREATE INDEX / CREATE UNIQUE INDEX statements
      const createIndexMatches = content.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]+/gi) ?? [];
      expect(createIndexMatches.length).toBeGreaterThan(0);

      for (const stmt of createIndexMatches) {
        expect(stmt.toUpperCase()).toContain('IF NOT EXISTS');
      }
    });

    it('schema.sql uses CREATE OR REPLACE for functions', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'schema.sql');
      const content = fs.readFileSync(schemaPath, 'utf-8');

      const createFunctionMatches =
        content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[^;]+/gi) ?? [];
      // There is at least the set_updated_at function
      expect(createFunctionMatches.length).toBeGreaterThan(0);

      for (const stmt of createFunctionMatches) {
        expect(stmt.toUpperCase()).toContain('OR REPLACE');
      }
    });

    it('schema.sql uses CREATE EXTENSION IF NOT EXISTS', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'schema.sql');
      const content = fs.readFileSync(schemaPath, 'utf-8');

      const extensionMatches = content.match(/CREATE\s+EXTENSION\b[^;]+/gi) ?? [];
      expect(extensionMatches.length).toBeGreaterThan(0);

      for (const stmt of extensionMatches) {
        expect(stmt.toUpperCase()).toContain('IF NOT EXISTS');
      }
    });
  });

  // ── DB-dependent idempotency test ──────────────────────────────────────────

  describe('schema idempotent application', () => {
    beforeAll(async () => {
      await testDb.setup();
    });

    afterAll(async () => {
      await testDb.teardown();
    });

    it.skipIf(!hasDb)('schema can be applied twice without error (idempotent)', async () => {
      // First application
      await expect(runMigrations()).resolves.toBeUndefined();

      // Second application -- should succeed without errors
      await expect(runMigrations()).resolves.toBeUndefined();
    });

    // schema.sql once fell twenty migrations behind and stopped loading at all.
    it.skipIf(!hasDb)('schema.sql builds the same schema as the migrations', async () => {
      await runMigrations();

      const migratedUrl = process.env['DATABASE_URL'];
      if (!migratedUrl) throw new Error('testDb.setup() did not set DATABASE_URL');

      const adminUrl = new URL(migratedUrl);
      adminUrl.pathname = '/postgres';
      const snapshotDbName = `immoradar_test_schema_sql_${process.pid}`;
      const snapshotUrl = new URL(migratedUrl);
      snapshotUrl.pathname = `/${snapshotDbName}`;

      const admin = new pg.Client({ connectionString: adminUrl.toString() });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${snapshotDbName}"`);
        await admin.query(`CREATE DATABASE "${snapshotDbName}"`);

        const schemaSql = fs.readFileSync(path.join(PROJECT_ROOT, 'schema.sql'), 'utf-8');
        const fromSchemaSql = await describeSchema(snapshotUrl.toString(), schemaSql);
        const fromMigrations = await describeSchema(migratedUrl);

        const inSchemaSql = new Set(fromSchemaSql);
        const inMigrations = new Set(fromMigrations);
        expect(
          {
            missingFromSchemaSql: fromMigrations.filter((item) => !inSchemaSql.has(item)),
            notInMigrations: fromSchemaSql.filter((item) => !inMigrations.has(item)),
          },
          'schema.sql is out of date. Regenerate it with npm run db:schema.',
        ).toEqual({ missingFromSchemaSql: [], notInMigrations: [] });
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS "${snapshotDbName}"`);
        await admin.end();
      }
    });
  });
});
