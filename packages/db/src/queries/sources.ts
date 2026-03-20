import { query } from '../client.js';
import type { SourceRow, SourceHealthStatus, ScrapeMode, LegalStatus } from '@rei/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface SourceDbRow {
  id: string;
  code: string;
  name: string;
  base_url: string;
  country_code: string;
  scrape_mode: ScrapeMode;
  is_active: boolean;
  health_status: SourceHealthStatus;
  crawl_interval_minutes: number;
  priority: number;
  rate_limit_rpm: number;
  concurrency_limit: number;
  parser_version: number;
  legal_status: LegalStatus;
  config: Record<string, unknown>;
  last_successful_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toSourceRow(row: SourceDbRow): SourceRow {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    baseUrl: row.base_url,
    countryCode: row.country_code,
    scrapeMode: row.scrape_mode,
    isActive: row.is_active,
    healthStatus: row.health_status,
    crawlIntervalMinutes: row.crawl_interval_minutes,
    priority: row.priority,
    rateLimitRpm: row.rate_limit_rpm,
    concurrencyLimit: row.concurrency_limit,
    parserVersion: row.parser_version,
    legalStatus: row.legal_status,
    config: row.config,
    lastSuccessfulRunAt: row.last_successful_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function findAll(): Promise<SourceRow[]> {
  const rows = await query<SourceDbRow>(
    'SELECT * FROM sources ORDER BY priority ASC, code ASC',
  );
  return rows.map(toSourceRow);
}

export async function findByCode(code: string): Promise<SourceRow | null> {
  const rows = await query<SourceDbRow>(
    'SELECT * FROM sources WHERE code = $1',
    [code],
  );
  const row = rows[0];
  return row ? toSourceRow(row) : null;
}

export async function findActive(): Promise<SourceRow[]> {
  const rows = await query<SourceDbRow>(
    'SELECT * FROM sources WHERE is_active = TRUE ORDER BY priority ASC, code ASC',
  );
  return rows.map(toSourceRow);
}

export interface SourceCreateInput {
  code: string;
  name: string;
  baseUrl: string;
  countryCode?: string;
  scrapeMode?: ScrapeMode;
  crawlIntervalMinutes?: number;
  priority?: number;
  rateLimitRpm?: number;
  concurrencyLimit?: number;
  parserVersion?: number;
  legalStatus?: LegalStatus;
  config?: Record<string, unknown>;
}

export async function create(input: SourceCreateInput): Promise<SourceRow> {
  const rows = await query<SourceDbRow>(
    `INSERT INTO sources (
       code, name, base_url, country_code, scrape_mode,
       crawl_interval_minutes, priority, rate_limit_rpm,
       concurrency_limit, parser_version, legal_status, config
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.code,
      input.name,
      input.baseUrl,
      input.countryCode ?? 'AT',
      input.scrapeMode ?? 'browser',
      input.crawlIntervalMinutes ?? 30,
      input.priority ?? 100,
      input.rateLimitRpm ?? 12,
      input.concurrencyLimit ?? 1,
      input.parserVersion ?? 1,
      input.legalStatus ?? 'review_required',
      JSON.stringify(input.config ?? {}),
    ],
  );
  return toSourceRow(rows[0]!);
}

export async function updateHealthStatus(
  id: number,
  healthStatus: SourceHealthStatus,
  lastSuccessfulRunAt?: Date,
): Promise<SourceRow | null> {
  const rows = await query<SourceDbRow>(
    `UPDATE sources
     SET health_status = $2,
         last_successful_run_at = COALESCE($3, last_successful_run_at)
     WHERE id = $1
     RETURNING *`,
    [id, healthStatus, lastSuccessfulRunAt ?? null],
  );
  const row = rows[0];
  return row ? toSourceRow(row) : null;
}
