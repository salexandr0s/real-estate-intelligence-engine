import { getPool, closePool } from '../src/client.js';
import { DEFAULT_SOURCE_SEEDS } from '../src/bootstrap.js';
import { createLogger } from '@immoradar/observability';

const logger = createLogger('db:seed');

// Tests compare the seeded rows with this list.
export { DEFAULT_SOURCE_SEEDS };

export async function seed(): Promise<void> {
  const pool = getPool();

  // Insert default app_user
  logger.info('Seeding default app_user...');
  await pool.query(
    `INSERT INTO app_users (email, display_name, timezone, locale)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    ['owner@example.com', 'Owner', 'Europe/Vienna', 'de-AT'],
  );

  // Insert sources with crawl profiles and rate limits
  logger.info('Seeding sources...');

  const sources = DEFAULT_SOURCE_SEEDS;

  for (const s of sources) {
    await pool.query(
      `INSERT INTO sources (
         code, name, base_url, scrape_mode, rate_limit_rpm,
         crawl_interval_minutes, priority, concurrency_limit,
         parser_version, legal_status, is_active, config
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         base_url = EXCLUDED.base_url,
         scrape_mode = EXCLUDED.scrape_mode,
         rate_limit_rpm = EXCLUDED.rate_limit_rpm,
         crawl_interval_minutes = EXCLUDED.crawl_interval_minutes,
         priority = EXCLUDED.priority,
         concurrency_limit = EXCLUDED.concurrency_limit,
         parser_version = EXCLUDED.parser_version,
         legal_status = EXCLUDED.legal_status,
         is_active = EXCLUDED.is_active,
         config = EXCLUDED.config`,
      [
        s.code,
        s.name,
        s.baseUrl,
        s.scrapeMode,
        s.rateLimitRpm,
        s.crawlIntervalMinutes,
        s.priority,
        s.concurrencyLimit,
        s.parserVersion,
        s.legalStatus,
        s.isActive,
        JSON.stringify(s.config),
      ],
    );
  }

  logger.info('Seed complete');
}

// CLI entry point
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'));

if (isMain) {
  seed()
    .then(() => closePool())
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Seed failed', { error: message });
      process.exitCode = 1;
      return closePool();
    });
}
