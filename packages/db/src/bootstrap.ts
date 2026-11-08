import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import type { LegalStatus, ScrapeMode } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';
import { queryWithClient, transaction } from './client.js';

const logger = createLogger('db:bootstrap');

// Resolved from this file, so the path holds under tsx, from dist, and in the runtime bundle,
// which copies all of packages/.
const POI_SEED_PATH = path.resolve(__dirname, '..', 'data', 'vienna-pois.json');

// Rows per INSERT. Each chunk goes to Postgres as one jsonb parameter of about 300 KB.
const POI_CHUNK_SIZE = 2_000;

// The API acts as user 1 in single-user mode (apps/api/src/middleware/auth.ts), so the owner needs
// that id even when a rolled-back insert already took it from the sequence.
const OWNER_USER_ID = 1;

export interface SourceSeed {
  code: string;
  name: string;
  baseUrl: string;
  scrapeMode: ScrapeMode;
  rateLimitRpm: number;
  crawlIntervalMinutes: number;
  priority: number;
  concurrencyLimit: number;
  parserVersion: number;
  legalStatus: LegalStatus;
  isActive: boolean;
  config: Record<string, unknown>;
}

const defaultCrawlProfile = {
  operationType: 'sale',
  propertyType: 'apartment',
  regions: ['wien'],
  maxPagesPerRun: 100, // Safety cap; parsers control actual stop via nextPagePlan
  sortOrder: 'published_desc',
};

export const DEFAULT_SOURCE_SEEDS: readonly SourceSeed[] = [
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
  {
    code: 'edikte',
    name: 'Ediktsdatei Justiz (Zwangsversteigerungen)',
    baseUrl: 'https://edikte.justiz.gv.at',
    scrapeMode: 'browser',
    rateLimitRpm: 6,
    crawlIntervalMinutes: 360,
    priority: 70,
    concurrencyLimit: 1,
    parserVersion: 1,
    legalStatus: 'approved',
    isActive: true,
    config: {
      crawlProfile: {
        operationType: 'sale',
        propertyType: null, // forced auctions cover all property types
        regions: ['wien'],
        maxPagesPerRun: 20, // ~160 total results for Wien, conservative cap
        sortOrder: 'published_desc',
      },
    },
  },
];

export interface BootstrapResult {
  ownerInserted: boolean;
  sourcesInserted: number;
  poisInserted: number;
}

/**
 * Adds the rows a fresh install needs to crawl and score: the owner user, the default sources and
 * the Vienna POIs. A table is filled only while it is empty, so rows the owner has edited or
 * deleted stay that way. Each table has its own transaction. A failure leaves that table empty,
 * and the next start tries it again.
 */
export async function bootstrapDefaults(): Promise<BootstrapResult> {
  const ownerInserted = await transaction(insertOwner);
  const sourcesInserted = await transaction(insertDefaultSources);
  const poisInserted = await transaction(insertDefaultPois);
  return { ownerInserted, sourcesInserted, poisInserted };
}

async function hasRows(
  client: PoolClient,
  table: 'app_users' | 'sources' | 'pois',
): Promise<boolean> {
  const rows = await queryWithClient<{ has_rows: boolean }>(
    client,
    `SELECT EXISTS (SELECT 1 FROM ${table}) AS has_rows`,
  );
  return rows[0]?.has_rows === true;
}

async function insertOwner(client: PoolClient): Promise<boolean> {
  if (await hasRows(client, 'app_users')) return false;

  // No email until the owner enters one. Alert email then skips the owner with a warning instead
  // of sending alerts to a placeholder address.
  const rows = await queryWithClient<{ id: string }>(
    client,
    `INSERT INTO app_users (id, display_name, timezone, locale)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [OWNER_USER_ID, 'Owner', 'Europe/Vienna', 'de-AT'],
  );
  if (rows.length === 0) return false;

  // An explicit id leaves the sequence where it was, and it would hand out the owner's id again.
  await queryWithClient(
    client,
    `SELECT setval(pg_get_serial_sequence('app_users', 'id'), (SELECT MAX(id) FROM app_users))`,
  );
  logger.info('Inserted the owner user', { userId: OWNER_USER_ID });
  return true;
}

async function insertDefaultSources(client: PoolClient): Promise<number> {
  if (await hasRows(client, 'sources')) return 0;

  const codes: string[] = [];
  for (const source of DEFAULT_SOURCE_SEEDS) {
    const rows = await queryWithClient<{ code: string }>(
      client,
      `INSERT INTO sources (
         code, name, base_url, scrape_mode, rate_limit_rpm,
         crawl_interval_minutes, priority, concurrency_limit,
         parser_version, legal_status, is_active, config
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [
        source.code,
        source.name,
        source.baseUrl,
        source.scrapeMode,
        source.rateLimitRpm,
        source.crawlIntervalMinutes,
        source.priority,
        source.concurrencyLimit,
        source.parserVersion,
        source.legalStatus,
        source.isActive,
        JSON.stringify(source.config),
      ],
    );
    if (rows[0]) codes.push(rows[0].code);
  }

  logger.info('Inserted the default sources', { count: codes.length, codes });
  return codes.length;
}

// Same keys as scripts/import-pois-to-db.ts, so a later import updates these rows instead of adding
// copies. Where the file repeats a key, the first row is kept.
const INSERT_POIS_SQL = `
  INSERT INTO pois (
    source_id, external_key, category, subcategory,
    name, latitude, longitude, district_no, properties
  )
  SELECT p.id, p."externalKey", p.category, p.subcategory,
         p.name, p.lat, p.lon, p."districtNo", COALESCE(p.properties, '{}'::jsonb)
  FROM jsonb_to_recordset($1::jsonb) AS p(
    id text, "externalKey" text, category text, subcategory text,
    name text, lat numeric, lon numeric, "districtNo" smallint, properties jsonb
  )
  ON CONFLICT (source_id, external_key) DO NOTHING`;

async function insertDefaultPois(client: PoolClient): Promise<number> {
  if (await hasRows(client, 'pois')) return 0;

  const pois = readPoiSeeds();
  let inserted = 0;
  for (let start = 0; start < pois.length; start += POI_CHUNK_SIZE) {
    const chunk = JSON.stringify(pois.slice(start, start + POI_CHUNK_SIZE));
    const result = await client.query(INSERT_POIS_SQL, [chunk]);
    inserted += result.rowCount ?? 0;
  }

  logger.info('Inserted the default POIs', { inserted, rowsInFile: pois.length });
  return inserted;
}

// Postgres checks each row's fields and types as it inserts them, so only the outer shape is
// checked here.
function readPoiSeeds(): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(POI_SEED_PATH, 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read the default POIs from ${POI_SEED_PATH}: ${reason}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${POI_SEED_PATH} does not hold a JSON array of POIs`);
  }
  return parsed;
}
