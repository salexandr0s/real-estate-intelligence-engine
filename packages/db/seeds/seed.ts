import { getPool, closePool } from '../src/client.js';
import { createLogger } from '@rei/observability';

const logger = createLogger('db:seed');

async function seed(): Promise<void> {
  const pool = getPool();

  // Insert default app_user
  logger.info('Seeding default app_user...');
  await pool.query(
    `INSERT INTO app_users (email, display_name, timezone, locale)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    ['owner@example.com', 'Owner', 'Europe/Vienna', 'de-AT'],
  );

  // Insert sample source: willhaben
  logger.info('Seeding willhaben source...');
  await pool.query(
    `INSERT INTO sources (code, name, base_url, scrape_mode)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO NOTHING`,
    ['willhaben', 'willhaben.at', 'https://www.willhaben.at', 'browser'],
  );

  logger.info('Seed complete');
}

seed()
  .then(() => closePool())
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Seed failed', { message });
    process.exitCode = 1;
    return closePool();
  });
