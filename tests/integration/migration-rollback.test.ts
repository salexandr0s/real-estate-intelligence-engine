import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from '@immoradar/db';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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
  });
});
