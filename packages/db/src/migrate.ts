import fs from 'node:fs';
import path from 'node:path';
import { getPool, closePool, transaction, queryWithClient } from './client.js';
import { createLogger } from '@rei/observability';

const logger = createLogger('db:migrate');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id          SERIAL PRIMARY KEY,
    filename    TEXT NOT NULL UNIQUE,
    checksum    CHAR(64) NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

/**
 * Compute a simple SHA-256 hex checksum of file content.
 */
async function sha256(content: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Read all *.sql files from the migrations directory, sorted by name.
 */
function readMigrationFiles(): Array<{ filename: string; content: string }> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn('Migrations directory not found', { path: MIGRATIONS_DIR });
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((filename) => ({
    filename,
    content: fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8'),
  }));
}

interface MigrationRecord {
  filename: string;
  checksum: string;
}

/**
 * Run all pending forward-only migrations.
 * Tracks applied migrations in the `_migrations` table.
 * Each migration runs inside its own transaction.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Ensure the tracking table exists (idempotent)
  await pool.query(ENSURE_TABLE_SQL);

  const migrations = readMigrationFiles();

  if (migrations.length === 0) {
    logger.info('No migration files found');
    return;
  }

  // Fetch already-applied migrations
  const applied = await pool.query<MigrationRecord>(
    'SELECT filename, checksum FROM _migrations ORDER BY filename',
  );
  const appliedMap = new Map(applied.rows.map((r) => [r.filename, r.checksum]));

  let appliedCount = 0;

  for (const migration of migrations) {
    const checksum = await sha256(migration.content);
    const existingChecksum = appliedMap.get(migration.filename);

    if (existingChecksum) {
      // Already applied -- verify checksum hasn't changed
      if (existingChecksum !== checksum) {
        throw new Error(
          `Migration ${migration.filename} has been modified after being applied. ` +
          `Expected checksum ${existingChecksum}, got ${checksum}. ` +
          'Migrations are forward-only and must not be altered once applied.',
        );
      }
      logger.debug(`Skipping already-applied migration: ${migration.filename}`);
      continue;
    }

    // Apply migration inside a transaction
    logger.info(`Applying migration: ${migration.filename}`);

    await transaction(async (client) => {
      await client.query(migration.content);
      await queryWithClient(
        client,
        'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
        [migration.filename, checksum],
      );
    });

    appliedCount++;
    logger.info(`Migration applied: ${migration.filename}`);
  }

  if (appliedCount === 0) {
    logger.info('All migrations already applied');
  } else {
    logger.info(`Applied ${appliedCount} migration(s)`);
  }
}

// CLI entry point
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'));

if (isMain) {
  runMigrations()
    .then(() => {
      logger.info('Migration complete');
      return closePool();
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Migration failed', { message });
      process.exitCode = 1;
      return closePool();
    });
}
