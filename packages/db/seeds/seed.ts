import { getPool, closePool } from '../src/client.js';
import { createLogger } from '@rei/observability';

const logger = createLogger('db:seed');

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

  const defaultCrawlProfile = {
    operationType: 'sale',
    propertyType: 'apartment',
    regions: ['wien'],
    maxPagesPerRun: 100, // Safety cap; parsers control actual stop via nextPagePlan
    sortOrder: 'published_desc',
  };

  const sources: Array<{
    code: string;
    name: string;
    baseUrl: string;
    scrapeMode: string;
    rateLimitRpm: number;
    crawlIntervalMinutes: number;
    priority: number;
    concurrencyLimit: number;
    parserVersion: number;
    legalStatus: string;
    isActive: boolean;
    config: Record<string, unknown>;
  }> = [
    {
      code: 'willhaben',
      name: 'willhaben.at',
      baseUrl: 'https://www.willhaben.at',
      scrapeMode: 'browser',
      rateLimitRpm: 10,
      crawlIntervalMinutes: 15,
      priority: 10,
      concurrencyLimit: 1,
      parserVersion: 1,
      legalStatus: 'approved',
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'immoscout24',
      name: 'ImmobilienScout24.at',
      baseUrl: 'https://www.immobilienscout24.at',
      scrapeMode: 'browser',
      rateLimitRpm: 8,
      crawlIntervalMinutes: 30,
      priority: 20,
      concurrencyLimit: 1,
      parserVersion: 2,
      legalStatus: 'review_required',
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'wohnnet',
      name: 'wohnnet.at',
      baseUrl: 'https://www.wohnnet.at',
      scrapeMode: 'browser',
      rateLimitRpm: 15,
      crawlIntervalMinutes: 30,
      priority: 30,
      concurrencyLimit: 1,
      parserVersion: 1,
      legalStatus: 'review_required',
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'derstandard',
      name: 'derstandard.at Immobilien',
      baseUrl: 'https://immobilien.derstandard.at',
      scrapeMode: 'browser',
      rateLimitRpm: 12,
      crawlIntervalMinutes: 60,
      priority: 40,
      concurrencyLimit: 1,
      parserVersion: 2,
      legalStatus: 'review_required',
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'findmyhome',
      name: 'findmyhome.at',
      baseUrl: 'https://www.findmyhome.at',
      scrapeMode: 'browser',
      rateLimitRpm: 15,
      crawlIntervalMinutes: 60,
      priority: 50,
      concurrencyLimit: 1,
      parserVersion: 2,
      legalStatus: 'review_required',
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'openimmo',
      name: 'openimmo.at',
      baseUrl: 'https://www.openimmo.at',
      scrapeMode: 'browser',
      rateLimitRpm: 15,
      crawlIntervalMinutes: 30,
      priority: 999,
      concurrencyLimit: 1,
      parserVersion: 1,
      legalStatus: 'disabled',
      isActive: false,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'remax',
      name: 'RE/MAX Austria',
      baseUrl: 'https://www.remax.at',
      scrapeMode: 'browser',
      rateLimitRpm: 10,
      crawlIntervalMinutes: 60,
      priority: 60,
      concurrencyLimit: 1,
      parserVersion: 2,
      legalStatus: 'review_required',
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
  ];

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
      logger.error('Seed failed', { message });
      process.exitCode = 1;
      return closePool();
    });
}
