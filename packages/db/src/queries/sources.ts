import { query } from '../client.js';
import type {
  SourceRow,
  SourceHealthStatus,
  ScrapeMode,
  LegalStatus,
  ScrapeRunStatus,
} from '@immoradar/contracts';

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

export interface SourceListingCountRow {
  sourceId: number;
  totalListingsIngested: number;
}

export interface SourceLifecycleSummaryRow {
  sourceId: number;
  explicitDead24h: number;
  explicitDead7d: number;
  staleExpired24h: number;
  staleExpired7d: number;
  lastExplicitDeadAt: Date | null;
  lastStaleExpiredAt: Date | null;
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

/** Sources that may run: switched on, and disabled neither legally nor by failed runs. */
export async function findActive(): Promise<SourceRow[]> {
  const rows = await query<SourceDbRow>(
    `SELECT * FROM sources
     WHERE is_active = TRUE
       AND legal_status <> 'disabled'
       AND health_status <> 'disabled'
     ORDER BY priority ASC, code ASC`,
  );
  return rows.map(toSourceRow);
}

export async function findListingCounts(): Promise<SourceListingCountRow[]> {
  const rows = await query<{ source_id: string; total_listings_ingested: string }>(
    `SELECT source_id, COUNT(*)::text AS total_listings_ingested
     FROM listings
     GROUP BY source_id`,
  );

  return rows.map((row) => ({
    sourceId: Number(row.source_id),
    totalListingsIngested: Number(row.total_listings_ingested),
  }));
}

export async function findLifecycleSummaries(): Promise<SourceLifecycleSummaryRow[]> {
  const rows = await query<{
    source_id: string;
    explicit_dead_24h: string;
    explicit_dead_7d: string;
    stale_expired_24h: string;
    stale_expired_7d: string;
    last_explicit_dead_at: Date | null;
    last_stale_expired_at: Date | null;
  }>(
    `SELECT
       s.id AS source_id,
       COUNT(lv.id) FILTER (
         WHERE lv.listing_status IN ('withdrawn', 'sold', 'rented')
           AND lv.observed_at >= NOW() - INTERVAL '24 hours'
       )::text AS explicit_dead_24h,
       COUNT(lv.id) FILTER (
         WHERE lv.listing_status IN ('withdrawn', 'sold', 'rented')
           AND lv.observed_at >= NOW() - INTERVAL '7 days'
       )::text AS explicit_dead_7d,
       COUNT(lv.id) FILTER (
         WHERE lv.listing_status = 'expired'
           AND lv.observed_at >= NOW() - INTERVAL '24 hours'
       )::text AS stale_expired_24h,
       COUNT(lv.id) FILTER (
         WHERE lv.listing_status = 'expired'
           AND lv.observed_at >= NOW() - INTERVAL '7 days'
       )::text AS stale_expired_7d,
       MAX(lv.observed_at) FILTER (
         WHERE lv.listing_status IN ('withdrawn', 'sold', 'rented')
       ) AS last_explicit_dead_at,
       MAX(lv.observed_at) FILTER (
         WHERE lv.listing_status = 'expired'
       ) AS last_stale_expired_at
     FROM sources s
     LEFT JOIN listings l
       ON l.source_id = s.id
     LEFT JOIN listing_versions lv
       ON lv.listing_id = l.id
      AND lv.version_reason = 'status_change'
      AND lv.listing_status IN ('withdrawn', 'sold', 'rented', 'expired')
     GROUP BY s.id`,
  );

  return rows.map((row) => ({
    sourceId: Number(row.source_id),
    explicitDead24h: Number(row.explicit_dead_24h),
    explicitDead7d: Number(row.explicit_dead_7d),
    staleExpired24h: Number(row.stale_expired_24h),
    staleExpired7d: Number(row.stale_expired_7d),
    lastExplicitDeadAt: row.last_explicit_dead_at,
    lastStaleExpiredAt: row.last_stale_expired_at,
  }));
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

/**
 * Switching a source on is the owner's override: a source that failed runs had
 * disabled gets one new run, and the reason for that disable goes.
 */
const ACTIVATE_SET = `is_active = TRUE,
  health_status = CASE WHEN health_status = 'disabled' THEN 'unknown' ELSE health_status END,
  config = config - 'disabledReason'`;

export type UpdateSettingsResult =
  | { outcome: 'updated'; source: SourceRow }
  | { outcome: 'not_found' }
  /** Nothing changed: a legally disabled source can't be switched on. */
  | { outcome: 'legally_disabled'; source: SourceRow };

/**
 * Change a source's settings. A legally disabled source is never switched on.
 * Changes that don't switch the source on keep `disabledReason`.
 */
export async function updateSettings(
  id: number,
  settings: { isActive?: boolean; crawlIntervalMinutes?: number },
): Promise<UpdateSettingsResult> {
  const activating = settings.isActive === true;
  const setClauses: string[] = [];
  // $1 is the id, and $2 says whether this switches the source on.
  const values: unknown[] = [id, activating];

  if (activating) setClauses.push(ACTIVATE_SET);
  if (settings.isActive === false) setClauses.push('is_active = FALSE');
  if (settings.crawlIntervalMinutes !== undefined) {
    values.push(settings.crawlIntervalMinutes);
    setClauses.push(`crawl_interval_minutes = $${values.length}`);
  }

  if (setClauses.length === 0) {
    const source = await findById(id);
    return source ? { outcome: 'updated', source } : { outcome: 'not_found' };
  }

  const rows = await query<SourceDbRow>(
    `UPDATE sources SET ${setClauses.join(', ')}
     WHERE id = $1 AND NOT ($2::boolean AND legal_status = 'disabled')
     RETURNING *`,
    values,
  );
  const row = rows[0];
  if (row) return { outcome: 'updated', source: toSourceRow(row) };

  const current = await findById(id);
  return current && activating && current.legalStatus === 'disabled'
    ? { outcome: 'legally_disabled', source: current }
    : { outcome: 'not_found' };
}

/** Pause or resume every source. Resuming skips legally disabled sources. */
export async function updateAllActive(isActive: boolean): Promise<number> {
  const rows = await query<{ count: string }>(
    isActive
      ? `WITH updated AS (
           UPDATE sources SET ${ACTIVATE_SET} WHERE legal_status <> 'disabled' RETURNING 1
         )
         SELECT count(*)::text AS count FROM updated`
      : `WITH updated AS (
           UPDATE sources SET is_active = FALSE RETURNING 1
         )
         SELECT count(*)::text AS count FROM updated`,
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

/** Failures older than this say nothing about the source's current pages. */
const FAILURE_WINDOW_DAYS = 14;

/**
 * Failures that say nothing about the source: the network dropped, or something
 * on our side broke before a page loaded (browser launch, database, adapter bug).
 */
const NOT_SOURCE_FAILURES = ['transient_network', 'internal_error'];

/**
 * Count the failed runs since the last successful one, which sets the source's
 * health and can disable it. Failures in NOT_SOURCE_FAILURES and runs older
 * than 14 days don't count, so neither our own errors nor old history can
 * disable a source on its first new run.
 */
export async function countConsecutiveFailures(sourceId: number): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
     FROM scrape_runs
     WHERE source_id = $1
       AND status IN ('failed', 'rate_limited')
       AND (error_code IS NULL OR error_code <> ALL($3::text[]))
       AND started_at > NOW() - make_interval(days => $2)
       AND started_at > (
         SELECT COALESCE(MAX(started_at), '-infinity')
         FROM scrape_runs
         WHERE source_id = $1
           AND status IN ('succeeded', 'partial')
       )`,
    [sourceId, FAILURE_WINDOW_DAYS, NOT_SOURCE_FAILURES],
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

/**
 * Applies a scrape-run outcome to source health/freshness metadata.
 *
 * Successful and partial runs both count as freshness-bearing observations and
 * immediately recover the source to healthy. Failed / rate-limited runs feed
 * the existing consecutive-failure health transition logic. Cancelled/running
 * runs leave source health unchanged.
 */
export async function applyRunOutcome(
  sourceId: number,
  status: ScrapeRunStatus,
  completedAt: Date = new Date(),
): Promise<{
  previousStatus: SourceHealthStatus;
  newStatus: SourceHealthStatus;
  changed: boolean;
}> {
  const source = await findById(sourceId);
  if (!source) {
    return { previousStatus: 'unknown', newStatus: 'unknown', changed: false };
  }

  if (status === 'succeeded' || status === 'partial') {
    const previousStatus = source.healthStatus;
    await updateHealthStatus(sourceId, 'healthy', completedAt);
    return {
      previousStatus,
      newStatus: 'healthy',
      changed: previousStatus !== 'healthy',
    };
  }

  if (status === 'failed' || status === 'rate_limited') {
    return checkAndUpdateHealth(sourceId);
  }

  return {
    previousStatus: source.healthStatus,
    newStatus: source.healthStatus,
    changed: false,
  };
}
