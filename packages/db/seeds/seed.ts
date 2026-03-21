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

  // Insert sources with crawl profiles and rate limits
  logger.info('Seeding sources...');

  const defaultCrawlProfile = {
    operationType: 'sale',
    propertyType: 'apartment',
    regions: ['wien'],
    maxPages: 5,
    sortOrder: 'published_desc',
  };

  const sources: Array<{
    code: string;
    name: string;
    baseUrl: string;
    scrapeMode: string;
    rateLimitRpm: number;
    isActive: boolean;
    config: Record<string, unknown>;
  }> = [
    {
      code: 'willhaben',
      name: 'willhaben.at',
      baseUrl: 'https://www.willhaben.at',
      scrapeMode: 'browser',
      rateLimitRpm: 10,
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'immoscout24',
      name: 'ImmobilienScout24.at',
      baseUrl: 'https://www.immobilienscout24.at',
      scrapeMode: 'browser',
      rateLimitRpm: 8,
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'wohnnet',
      name: 'wohnnet.at',
      baseUrl: 'https://www.wohnnet.at',
      scrapeMode: 'browser',
      rateLimitRpm: 15,
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'derstandard',
      name: 'derstandard.at Immobilien',
      baseUrl: 'https://immobilien.derstandard.at',
      scrapeMode: 'browser',
      rateLimitRpm: 12,
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'findmyhome',
      name: 'findmyhome.at',
      baseUrl: 'https://www.findmyhome.at',
      scrapeMode: 'browser',
      rateLimitRpm: 15,
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'openimmo',
      name: 'openimmo.at',
      baseUrl: 'https://www.openimmo.at',
      scrapeMode: 'browser',
      rateLimitRpm: 15,
      isActive: false,
      config: { crawlProfile: defaultCrawlProfile },
    },
    {
      code: 'remax',
      name: 'RE/MAX Austria',
      baseUrl: 'https://www.remax.at',
      scrapeMode: 'browser',
      rateLimitRpm: 10,
      isActive: true,
      config: { crawlProfile: defaultCrawlProfile },
    },
  ];

  for (const s of sources) {
    await pool.query(
      `INSERT INTO sources (code, name, base_url, scrape_mode, rate_limit_rpm, is_active, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         base_url = EXCLUDED.base_url,
         scrape_mode = EXCLUDED.scrape_mode,
         rate_limit_rpm = EXCLUDED.rate_limit_rpm,
         is_active = EXCLUDED.is_active,
         config = EXCLUDED.config`,
      [s.code, s.name, s.baseUrl, s.scrapeMode, s.rateLimitRpm, s.isActive, JSON.stringify(s.config)],
    );
  }

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
