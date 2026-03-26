import pg from 'pg';
import { resetConfig } from '@immoradar/config';
import { closePool } from '@immoradar/db';

interface CreatePostgresTestDatabaseOptions {
  namePrefix: string;
  enabled?: boolean;
}

export interface PostgresTestDatabase {
  dbName: string;
  enabled: boolean;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

export function createPostgresTestDatabase(
  options: CreatePostgresTestDatabaseOptions,
): PostgresTestDatabase {
  const dbName = `${options.namePrefix}_${process.pid}`;
  const enabled = options.enabled ?? Boolean(process.env['DATABASE_URL']);

  let adminClient: pg.Client | null = null;
  let originalDatabaseUrl: string | undefined;

  return {
    dbName,
    enabled,
    async setup() {
      if (!enabled) return;

      originalDatabaseUrl = process.env['DATABASE_URL'];
      const adminUrl =
        originalDatabaseUrl ?? 'postgres://postgres:postgres@localhost:5432/postgres';
      const parsed = new URL(adminUrl);
      parsed.pathname = '/postgres';

      adminClient = new pg.Client({ connectionString: parsed.toString() });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await adminClient.query(`CREATE DATABASE "${dbName}"`);

      parsed.pathname = `/${dbName}`;
      process.env['DATABASE_URL'] = parsed.toString();
      resetConfig();
    },
    async teardown() {
      if (!enabled || !adminClient) return;

      await closePool();

      if (originalDatabaseUrl !== undefined) {
        process.env['DATABASE_URL'] = originalDatabaseUrl;
      } else {
        delete process.env['DATABASE_URL'];
      }
      resetConfig();

      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await adminClient.end();
    },
  };
}
