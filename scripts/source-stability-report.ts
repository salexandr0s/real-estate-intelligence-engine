#!/usr/bin/env npx tsx
/**
 * Source stability gate report.
 *
 * Evaluates the last N days for one source against the KPI/SLO thresholds in
 * docs/phase0/kpi-slo.md and includes recent canary evidence.
 *
 * Usage:
 *   npx tsx scripts/source-stability-report.ts --source willhaben [--window-days 7] [--gate]
 */

import { loadConfig } from '@immoradar/config';
import { canaryResults, closePool, query } from '@immoradar/db';

const DEFAULT_SOURCE = 'willhaben';
const DEFAULT_WINDOW_DAYS = 7;
const CRAWL_SUCCESS_THRESHOLD_PCT = 95;
const PARSE_SUCCESS_THRESHOLD_PCT = 90;
const MAX_ZERO_RUN_GAP_HOURS = 2;

interface SourceRow {
  id: string;
  code: string;
  name: string;
  health_status: 'healthy' | 'degraded' | 'blocked' | 'disabled' | 'unknown';
  last_successful_run_at: Date | null;
}

interface RunWindowRow {
  total_runs: string;
  successful_runs: string;
  partial_runs: string;
  last_success_at: Date | null;
  max_inter_run_gap_hours: string | null;
}

interface ParseWindowRow {
  total_attempts: string;
  captured_attempts: string;
}

function parseArgs(): { sourceCode: string; windowDays: number; gate: boolean } {
  const args = process.argv.slice(2);
  let sourceCode = DEFAULT_SOURCE;
  let windowDays = DEFAULT_WINDOW_DAYS;
  let gate = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
      continue;
    }

    if (args[i] === '--window-days' && args[i + 1]) {
      windowDays = Number.parseInt(args[i + 1]!, 10);
      i++;
      continue;
    }

    if (args[i] === '--gate') {
      gate = true;
    }
  }

  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error('--window-days must be a positive integer');
  }

  return { sourceCode, windowDays, gate };
}

function formatPct(value: number | null): string {
  return value == null ? 'n/a' : `${value.toFixed(1)}%`;
}

function formatHours(value: number | null): string {
  return value == null ? 'n/a' : `${value.toFixed(2)}h`;
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString() : 'n/a';
}

function statusLabel(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

async function main(): Promise<void> {
  const { sourceCode, windowDays, gate } = parseArgs();
  loadConfig();

  const [source] = await query<SourceRow>(
    `SELECT id::text, code, name, health_status, last_successful_run_at
     FROM sources
     WHERE code = $1
     LIMIT 1`,
    [sourceCode],
  );

  if (!source) {
    throw new Error(`Unknown source: ${sourceCode}`);
  }

  const [runWindow] = await query<RunWindowRow>(
    `WITH successful_runs AS (
       SELECT COALESCE(finished_at, started_at, scheduled_at) AS run_time
       FROM scrape_runs
       WHERE source_id = $1
         AND scheduled_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND status IN ('succeeded', 'partial')
     ),
     run_gaps AS (
       SELECT EXTRACT(EPOCH FROM (run_time - LAG(run_time) OVER (ORDER BY run_time))) / 3600 AS gap_hours
       FROM successful_runs
     )
     SELECT
       COUNT(*) FILTER (
         WHERE scheduled_at >= NOW() - ($2::int * INTERVAL '1 day')
       )::text AS total_runs,
       COUNT(*) FILTER (
         WHERE scheduled_at >= NOW() - ($2::int * INTERVAL '1 day')
           AND status IN ('succeeded', 'partial')
       )::text AS successful_runs,
       COUNT(*) FILTER (
         WHERE scheduled_at >= NOW() - ($2::int * INTERVAL '1 day')
           AND status = 'partial'
       )::text AS partial_runs,
       MAX(COALESCE(finished_at, started_at, scheduled_at)) FILTER (
         WHERE scheduled_at >= NOW() - ($2::int * INTERVAL '1 day')
           AND status IN ('succeeded', 'partial')
       ) AS last_success_at,
       (
         SELECT MAX(gap_hours)::text
         FROM run_gaps
       ) AS max_inter_run_gap_hours
     FROM scrape_runs
     WHERE source_id = $1`,
    [Number(source.id), windowDays],
  );

  const [parseWindow] = await query<ParseWindowRow>(
    `SELECT
       COUNT(*)::text AS total_attempts,
       COUNT(*) FILTER (WHERE extraction_status = 'captured')::text AS captured_attempts
     FROM raw_listings
     WHERE source_id = $1
       AND observed_at >= NOW() - ($2::int * INTERVAL '1 day')`,
    [Number(source.id), windowDays],
  );

  const recentCanaries = await canaryResults.findBySourceCode(sourceCode, 5);

  const totalRuns = Number(runWindow?.total_runs ?? 0);
  const successfulRuns = Number(runWindow?.successful_runs ?? 0);
  const partialRuns = Number(runWindow?.partial_runs ?? 0);
  const totalAttempts = Number(parseWindow?.total_attempts ?? 0);
  const capturedAttempts = Number(parseWindow?.captured_attempts ?? 0);
  const lastSuccessAt = runWindow?.last_success_at ?? source.last_successful_run_at ?? null;
  const historicalGapHours =
    runWindow?.max_inter_run_gap_hours != null ? Number(runWindow.max_inter_run_gap_hours) : null;
  const currentGapHours =
    lastSuccessAt != null ? (Date.now() - lastSuccessAt.getTime()) / 3_600_000 : null;
  const effectiveGapHours =
    historicalGapHours == null
      ? currentGapHours
      : currentGapHours == null
        ? historicalGapHours
        : Math.max(historicalGapHours, currentGapHours);

  const crawlSuccessPct = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : null;
  const parseSuccessPct = totalAttempts > 0 ? (capturedAttempts / totalAttempts) * 100 : null;

  const crawlPass = crawlSuccessPct != null && crawlSuccessPct > CRAWL_SUCCESS_THRESHOLD_PCT;
  const parsePass = parseSuccessPct != null && parseSuccessPct > PARSE_SUCCESS_THRESHOLD_PCT;
  const gapPass = effectiveGapHours != null && effectiveGapHours < MAX_ZERO_RUN_GAP_HOURS;
  const healthPass =
    source.health_status === 'healthy' ||
    (source.health_status === 'degraded' &&
      effectiveGapHours != null &&
      effectiveGapHours < MAX_ZERO_RUN_GAP_HOURS);
  const latestCanary = recentCanaries[0] ?? null;
  const canaryPass = latestCanary ? latestCanary.success : true;

  const overallPass = crawlPass && parsePass && gapPass && healthPass && canaryPass;

  console.log('\n=== Source Stability Report ===\n');
  console.log(`Source:               ${source.name} (${source.code})`);
  console.log(`Window:               last ${windowDays} day(s)`);
  console.log(`Partial-run handling: succeeded + partial both count as crawl-success SLO passes`);
  console.log(`Generated at:         ${new Date().toISOString()}\n`);

  console.log('Run reliability');
  console.log(`  Total runs:         ${totalRuns}`);
  console.log(`  Successful runs:    ${successfulRuns}`);
  console.log(`  Partial runs:       ${partialRuns}`);
  console.log(
    `  Crawl success:      ${formatPct(crawlSuccessPct)} (${statusLabel(crawlPass)} > ${CRAWL_SUCCESS_THRESHOLD_PCT}%)`,
  );
  console.log(`  Last success:       ${formatDate(lastSuccessAt)}\n`);

  console.log('Parse reliability');
  console.log(`  Raw attempts:       ${totalAttempts}`);
  console.log(`  Captured rows:      ${capturedAttempts}`);
  console.log(
    `  Parse success:      ${formatPct(parseSuccessPct)} (${statusLabel(parsePass)} > ${PARSE_SUCCESS_THRESHOLD_PCT}%)\n`,
  );

  console.log('Gap / availability');
  console.log(`  Max inter-run gap:  ${formatHours(historicalGapHours)}`);
  console.log(`  Current gap:        ${formatHours(currentGapHours)}`);
  console.log(
    `  Effective max gap:  ${formatHours(effectiveGapHours)} (${statusLabel(gapPass)} < ${MAX_ZERO_RUN_GAP_HOURS}h)`,
  );
  console.log(
    `  Source health:      ${source.health_status} (${statusLabel(healthPass)} inferred from current source status + gap)\n`,
  );

  console.log('Recent canary evidence');
  if (recentCanaries.length === 0) {
    console.log('  Latest canary:      none recorded');
    console.log('  Canary verdict:     WARN (missing recent canary evidence)\n');
  } else {
    const canarySuccessCount = recentCanaries.filter((entry) => entry.success).length;
    console.log(
      `  Latest canary:      ${latestCanary?.createdAt.toISOString()} (${latestCanary?.success ? 'PASS' : 'FAIL'})`,
    );
    console.log(
      `  Last ${recentCanaries.length}:        ${canarySuccessCount}/${recentCanaries.length} successful`,
    );
    if (latestCanary?.errorMessage) {
      console.log(`  Latest error:       ${latestCanary.errorMessage}`);
    }
    console.log('');
  }

  console.log(`Gate result:          ${overallPass ? 'PASS' : 'FAIL'}\n`);

  await closePool();
  if (gate && !overallPass) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('Source stability report failed:', error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
