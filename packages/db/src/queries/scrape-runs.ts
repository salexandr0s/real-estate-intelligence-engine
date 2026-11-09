import { query } from '../client.js';
import type {
  ProcessingRunMetrics,
  ScrapeRunCause,
  ScrapeRunCreate,
  ScrapeRunRow,
  ScrapeRunStatus,
  ScrapeRunTriggerType,
  ScrapeRunScope,
  ScraperRunMetrics,
} from '@immoradar/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface ScrapeRunDbRow {
  id: string;
  run_uuid: string;
  source_id: string;
  trigger_type: ScrapeRunTriggerType;
  scope: ScrapeRunScope;
  status: ScrapeRunStatus;
  seed_name: string | null;
  seed_url: string | null;
  scheduled_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  worker_host: string | null;
  worker_version: string | null;
  browser_type: string | null;
  browser_version: string | null;
  pages_fetched: number;
  listings_discovered: number;
  raw_snapshots_created: number;
  normalized_created: number;
  normalized_updated: number;
  http_2xx: number;
  http_4xx: number;
  http_5xx: number;
  captcha_count: number;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function toScrapeRunRow(row: ScrapeRunDbRow): ScrapeRunRow {
  return {
    id: Number(row.id),
    runUuid: row.run_uuid,
    sourceId: Number(row.source_id),
    triggerType: row.trigger_type,
    scope: row.scope,
    status: row.status,
    seedName: row.seed_name,
    seedUrl: row.seed_url,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    workerHost: row.worker_host,
    workerVersion: row.worker_version,
    browserType: row.browser_type,
    browserVersion: row.browser_version,
    pagesFetched: row.pages_fetched,
    listingsDiscovered: row.listings_discovered,
    rawSnapshotsCreated: row.raw_snapshots_created,
    normalizedCreated: row.normalized_created,
    normalizedUpdated: row.normalized_updated,
    http2xx: row.http_2xx,
    http4xx: row.http_4xx,
    http5xx: row.http_5xx,
    captchaCount: row.captcha_count,
    retryCount: row.retry_count,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    meta: row.meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function create(input: ScrapeRunCreate): Promise<ScrapeRunRow> {
  const rows = await query<ScrapeRunDbRow>(
    `INSERT INTO scrape_runs (
       source_id, trigger_type, scope, seed_name, seed_url,
       worker_host, worker_version, browser_type, browser_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.sourceId,
      input.triggerType,
      input.scope,
      input.seedName ?? null,
      input.seedUrl ?? null,
      input.workerHost ?? null,
      input.workerVersion ?? null,
      input.browserType ?? null,
      input.browserVersion ?? null,
    ],
  );
  return toScrapeRunRow(rows[0]!);
}

/**
 * Mark a queued run as running. Returns null when the run is no longer queued:
 * it was cancelled or has already started.
 */
export async function start(id: number): Promise<ScrapeRunRow | null> {
  const rows = await query<ScrapeRunDbRow>(
    `UPDATE scrape_runs
     SET status = 'running', started_at = NOW()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [id],
  );
  const row = rows[0];
  return row ? toScrapeRunRow(row) : null;
}

/**
 * Close a run with the scraper's counters and, for a failure, its cause. The raw
 * and normalized counts stay as processing left them: it adds to them with
 * `incrementMetrics`, often after the run has finished.
 *
 * Returns null when the run had already ended, so a run that the user or
 * `cancelZombieRuns` cancelled stays cancelled.
 */
export async function finish(
  id: number,
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'rate_limited',
  metrics: ScraperRunMetrics,
  cause?: ScrapeRunCause,
): Promise<ScrapeRunRow | null> {
  const rows = await query<ScrapeRunDbRow>(
    `UPDATE scrape_runs
     SET status = $2,
         finished_at = NOW(),
         pages_fetched = $3,
         listings_discovered = $4,
         http_2xx = $5,
         http_4xx = $6,
         http_5xx = $7,
         captcha_count = $8,
         retry_count = $9,
         error_code = $10,
         error_message = $11
     WHERE id = $1 AND status IN ('queued', 'running')
     RETURNING *`,
    [
      id,
      status,
      metrics.pagesFetched,
      metrics.listingsDiscovered,
      metrics.http2xx,
      metrics.http4xx,
      metrics.http5xx,
      metrics.captchaCount,
      metrics.retryCount,
      cause?.errorCode ?? null,
      cause?.errorMessage ?? null,
    ],
  );
  const row = rows[0];
  return row ? toScrapeRunRow(row) : null;
}

export async function findById(id: number): Promise<ScrapeRunRow | null> {
  const rows = await query<ScrapeRunDbRow>(`SELECT * FROM scrape_runs WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toScrapeRunRow(row) : null;
}

export async function cancel(id: number): Promise<ScrapeRunRow | null> {
  const rows = await query<ScrapeRunDbRow>(
    `UPDATE scrape_runs
     SET status = 'cancelled',
         finished_at = NOW(),
         error_code = 'user_cancelled',
         error_message = 'Cancelled by user'
     WHERE id = $1 AND status IN ('queued', 'running')
     RETURNING *`,
    [id],
  );
  const row = rows[0];
  return row ? toScrapeRunRow(row) : null;
}

export async function findRecent(sourceId: number, limit = 10): Promise<ScrapeRunRow[]> {
  const rows = await query<ScrapeRunDbRow>(
    `SELECT * FROM scrape_runs
     WHERE source_id = $1
     ORDER BY scheduled_at DESC
     LIMIT $2`,
    [sourceId, limit],
  );
  return rows.map(toScrapeRunRow);
}

/**
 * Each source's most recent run that has ended, one row per source. Queued and running runs are
 * left out: they have no outcome yet, and counting them would hide the last error during a run.
 */
export async function findLatestFinishedPerSource(): Promise<ScrapeRunRow[]> {
  const rows = await query<ScrapeRunDbRow>(
    `SELECT DISTINCT ON (source_id) *
     FROM scrape_runs
     WHERE status NOT IN ('queued', 'running')
     ORDER BY source_id, scheduled_at DESC, id DESC`,
  );
  return rows.map(toScrapeRunRow);
}

export async function findRecentAll(
  sourceId: number | null,
  limit = 10,
): Promise<(ScrapeRunRow & { sourceCode: string })[]> {
  const rows = await query<ScrapeRunDbRow & { source_code: string }>(
    `SELECT sr.*, s.code AS source_code
     FROM scrape_runs sr
     JOIN sources s ON s.id = sr.source_id
     WHERE ($1::bigint IS NULL OR sr.source_id = $1)
     ORDER BY sr.scheduled_at DESC
     LIMIT $2`,
    [sourceId, limit],
  );
  return rows.map((row) => ({ ...toScrapeRunRow(row), sourceCode: row.source_code }));
}

/**
 * Cancel runs a crash left open: running for longer than the threshold, or still
 * queued that long after they were scheduled.
 */
export async function cancelZombieRuns(thresholdMinutes = 30): Promise<number> {
  const [row] = await query<{ count: string }>(
    `WITH cancelled AS (
       UPDATE scrape_runs
       SET status = 'cancelled',
           finished_at = NOW(),
           error_code = 'zombie_timeout',
           error_message = 'Cancelled: stuck in ' || status || ' state for > ' || $1::int || ' minutes'
       WHERE (status = 'running' AND started_at < NOW() - make_interval(mins => $1::int))
          OR (status = 'queued' AND scheduled_at < NOW() - make_interval(mins => $1::int))
       RETURNING id
     )
     SELECT COUNT(*) AS count FROM cancelled`,
    [thresholdMinutes],
  );
  return Number(row!.count);
}

/**
 * Cancel the runs a stopped scraper left running. An engine runs one scraper, so when it starts,
 * every scheduled or app-started run still marked running was cut off. Runs a command-line script
 * started belong to that script's process and are left alone.
 */
export async function cancelInterruptedRuns(): Promise<number> {
  const [row] = await query<{ count: string }>(
    `WITH cancelled AS (
       UPDATE scrape_runs
       SET status = 'cancelled',
           finished_at = NOW(),
           error_code = 'interrupted',
           error_message = 'The scraper stopped during the run'
       WHERE status = 'running' AND worker_host IN ('discovery-worker', 'api')
       RETURNING id
     )
     SELECT COUNT(*) AS count FROM cancelled`,
  );
  return Number(row!.count);
}

/** Find the rolling average of listings_discovered for recent successful runs. */
export async function findRecentAverage(
  sourceId: number,
  windowHours = 168,
): Promise<{ avgDiscovered: number; runCount: number }> {
  const [row] = await query<{ avg_discovered: string; run_count: string }>(
    `SELECT COALESCE(AVG(listings_discovered), 0) AS avg_discovered,
            COUNT(*) AS run_count
     FROM scrape_runs
     WHERE source_id = $1
       AND status = 'succeeded'
       AND finished_at > NOW() - make_interval(hours => $2)`,
    [sourceId, windowHours],
  );
  return {
    avgDiscovered: Number(row!.avg_discovered),
    runCount: Number(row!.run_count),
  };
}

/** Calculate the success rate of recent scrape runs for a source. */
export async function getRecentSuccessRate(
  sourceId: number,
  limit = 20,
): Promise<{ successRate: number; totalRuns: number }> {
  const [row] = await query<{ success_count: string; total_count: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('succeeded', 'partial')) AS success_count,
       COUNT(*) AS total_count
     FROM (
       SELECT status FROM scrape_runs
       WHERE source_id = $1
       ORDER BY scheduled_at DESC
       LIMIT $2
     ) recent`,
    [sourceId, limit],
  );
  const total = Number(row!.total_count);
  const successes = Number(row!.success_count);
  return {
    successRate: total > 0 ? successes / total : 0,
    totalRuns: total,
  };
}

/** Set the scraper's counters during a run. Processing counts go through `incrementMetrics`. */
export async function updateMetrics(
  id: number,
  metrics: Partial<ScraperRunMetrics>,
): Promise<ScrapeRunRow | null> {
  const rows = await query<ScrapeRunDbRow>(
    `UPDATE scrape_runs
     SET pages_fetched = COALESCE($2, pages_fetched),
         listings_discovered = COALESCE($3, listings_discovered),
         http_2xx = COALESCE($4, http_2xx),
         http_4xx = COALESCE($5, http_4xx),
         http_5xx = COALESCE($6, http_5xx),
         captcha_count = COALESCE($7, captcha_count),
         retry_count = COALESCE($8, retry_count)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      metrics.pagesFetched ?? null,
      metrics.listingsDiscovered ?? null,
      metrics.http2xx ?? null,
      metrics.http4xx ?? null,
      metrics.http5xx ?? null,
      metrics.captchaCount ?? null,
      metrics.retryCount ?? null,
    ],
  );
  const row = rows[0];
  return row ? toScrapeRunRow(row) : null;
}

/**
 * Add one capture's processing counts to its run. Each column adds in place, so
 * concurrent captures and the scraper's `finish` can't overwrite each other.
 */
export async function incrementMetrics(
  id: number,
  delta: Partial<ProcessingRunMetrics>,
): Promise<void> {
  const raw = delta.rawSnapshotsCreated ?? 0;
  const created = delta.normalizedCreated ?? 0;
  const updated = delta.normalizedUpdated ?? 0;
  if (raw === 0 && created === 0 && updated === 0) return;

  await query(
    `UPDATE scrape_runs
     SET raw_snapshots_created = raw_snapshots_created + $2,
         normalized_created = normalized_created + $3,
         normalized_updated = normalized_updated + $4
     WHERE id = $1`,
    [id, raw, created, updated],
  );
}
