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
  const rows = await query<SourceDbRow>('SELECT * FROM sources ORDER BY priority ASC, code ASC');
  return rows.map(toSourceRow);
}

export async function findByCode(code: string): Promise<SourceRow | null> {
  const rows = await query<SourceDbRow>('SELECT * FROM sources WHERE code = $1', [code]);
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

export async function findById(id: number): Promise<SourceRow | null> {
  const rows = await query<SourceDbRow>('SELECT * FROM sources WHERE id = $1', [id]);
  const row = rows[0];
  return row ? toSourceRow(row) : null;
}

export async function updateActive(id: number, isActive: boolean): Promise<SourceRow | null> {
  const rows = await query<SourceDbRow>(
    `UPDATE sources
     SET is_active = $2
     WHERE id = $1
     RETURNING *`,
    [id, isActive],
  );
  const row = rows[0];
  return row ? toSourceRow(row) : null;
}

export async function updateAllActive(isActive: boolean): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH updated AS (
       UPDATE sources SET is_active = $1 RETURNING 1
     )
     SELECT count(*)::text AS count FROM updated`,
    [isActive],
  );
  return Number(rows[0]?.count ?? 0);
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

/**
 * Count consecutive failures since the last successful scrape run for a source.
 * Used for auto-disable logic.
 */
export async function countConsecutiveFailures(sourceId: number): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
     FROM scrape_runs
     WHERE source_id = $1
       AND status IN ('failed', 'rate_limited')
       AND started_at > (
         SELECT COALESCE(MAX(started_at), '1970-01-01')
         FROM scrape_runs
         WHERE source_id = $1
           AND status IN ('succeeded', 'partial')
       )`,
    [sourceId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Disable a source with a reason, setting health_status to 'disabled'.
 */
export async function disableWithReason(id: number, reason: string): Promise<SourceRow | null> {
  const rows = await query<SourceDbRow>(
    `UPDATE sources
     SET is_active = false,
         health_status = 'disabled',
         config = jsonb_set(COALESCE(config, '{}')::jsonb, '{disabledReason}', $2::jsonb)
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(reason)],
  );
  const row = rows[0];
  return row ? toSourceRow(row) : null;
}

/**
 * Check and update source health based on recent scrape run outcomes.
 * Returns the previous and new health status.
 */
export async function checkAndUpdateHealth(sourceId: number): Promise<{
  previousStatus: SourceHealthStatus;
  newStatus: SourceHealthStatus;
  changed: boolean;
}> {
  const source = await findById(sourceId);
  if (!source) {
    return { previousStatus: 'unknown', newStatus: 'unknown', changed: false };
  }

  const previousStatus = source.healthStatus;
  const consecutiveFailures = await countConsecutiveFailures(sourceId);

  let newStatus: SourceHealthStatus;
  if (consecutiveFailures === 0) {
    newStatus = 'healthy';
  } else if (consecutiveFailures <= 2) {
    newStatus = 'degraded';
  } else if (consecutiveFailures <= 4) {
    newStatus = 'blocked';
  } else {
    newStatus = 'disabled';
  }

  if (newStatus !== previousStatus) {
    await updateHealthStatus(sourceId, newStatus);
  }

  return { previousStatus, newStatus, changed: newStatus !== previousStatus };
}
