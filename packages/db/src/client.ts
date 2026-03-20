import pg from 'pg';
import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';

const logger = createLogger('db');

let pool: pg.Pool | null = null;

/**
 * Returns (and lazily creates) the shared connection pool.
 * Uses DATABASE_URL and pool settings from @rei/config.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;

  const config = loadConfig();

  pool = new pg.Pool({
    connectionString: config.database.url,
    max: config.database.poolMax,
    statement_timeout: config.database.statementTimeoutMs,
    idle_in_transaction_session_timeout: 30_000,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected pool error', { errorClass: err.name, message: err.message } as Record<string, unknown>);
  });

  pool.on('connect', () => {
    logger.debug('New pool connection established');
  });

  return pool;
}

/**
 * Typed query helper. Executes a parameterized SQL statement and returns
 * the rows cast to T[]. Column names in the result use the database
 * snake_case names; callers are responsible for mapping if needed.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const p = getPool();
  const result = await p.query<T>(sql, params);
  return result.rows;
}

/**
 * Execute a single parameterized statement, returning the full QueryResult
 * (useful when you need rowCount).
 */
export async function execute(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult> {
  const p = getPool();
  return p.query(sql, params);
}

/**
 * Run a callback inside a database transaction.
 * The transaction is committed on success, rolled back on error.
 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Typed query helper that runs on a specific client (for use inside transactions).
 */
export async function queryWithClient<T extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.PoolClient,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

/**
 * Gracefully shut down the connection pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}
