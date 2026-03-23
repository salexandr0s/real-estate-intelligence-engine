#!/usr/bin/env npx tsx
/**
 * Data quality reports for the listing database.
 *
 * Runs 4 reports and prints results to stdout:
 *   1. Missing critical fields (grouped by source and field)
 *   2. District inference audit (resolution rate for Vienna listings)
 *   3. Outlier listings (price/sqm >3 stddev from district median)
 *   4. Duplicate candidates (cross-source fingerprint collisions)
 *
 * Usage:
 *   npx tsx scripts/data-quality-report.ts [--source <code>] [--gate]
 */

import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';
import { query, closePool } from '@rei/db';

const log = createLogger('data-quality');

// ── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(): { sourceCode: string | null; gate: boolean } {
  const args = process.argv.slice(2);
  let sourceCode: string | null = null;
  let gate = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
    }
    if (args[i] === '--gate') {
      gate = true;
    }
  }

  return { sourceCode, gate };
}

// ── Quality Gate Thresholds ──────────────────────────────────────────────────

interface GateResult {
  name: string;
  passed: boolean;
  actual: number;
  threshold: number;
  unit: string;
}

const GATE_THRESHOLDS = {
  /** Max percentage of active listings missing any critical field per source */
  maxMissingFieldPct: 25,
  /** Min percentage of Vienna listings with district resolved */
  minDistrictResolutionPct: 85,
  /** Max number of extreme outliers (>3 stddev) — if too many, data may be polluted */
  maxOutlierCount: 20,
} as const;

// ── Report 1: Missing Critical Fields ───────────────────────────────────────

interface MissingFieldRow {
  source_code: string;
  field_name: string;
  missing_count: string;
}

async function reportMissingFields(sourceCode: string | null): Promise<void> {
  console.log('='.repeat(60));
  console.log('REPORT 1: Missing Critical Fields');
  console.log('='.repeat(60));

  const sourceFilter = sourceCode ? 'AND s.code = $1' : '';
  const params = sourceCode ? [sourceCode] : [];

  const rows = await query<MissingFieldRow>(
    `SELECT
       s.code AS source_code,
       field_name,
       COUNT(*) AS missing_count
     FROM listings l
     JOIN sources s ON s.id = l.source_id
     CROSS JOIN LATERAL (
       VALUES
         ('list_price_eur_cents', l.list_price_eur_cents IS NULL),
         ('living_area_sqm', l.living_area_sqm IS NULL),
         ('district_no', l.district_no IS NULL),
         ('rooms', l.rooms IS NULL)
     ) AS fields(field_name, is_missing)
     WHERE l.listing_status = 'active'
       AND fields.is_missing = TRUE
       ${sourceFilter}
     GROUP BY s.code, field_name
     ORDER BY s.code, missing_count DESC`,
    params,
  );

  if (rows.length === 0) {
    console.log('  No missing critical fields found.\n');
    return;
  }

  console.log(`  ${'Source'.padEnd(20)} ${'Field'.padEnd(25)} Count`);
  console.log(`  ${'─'.repeat(20)} ${'─'.repeat(25)} ${'─'.repeat(10)}`);
  for (const row of rows) {
    console.log(
      `  ${row.source_code.padEnd(20)} ${row.field_name.padEnd(25)} ${row.missing_count}`,
    );
  }
  console.log('');
}

// ── Report 2: District Inference Audit ──────────────────────────────────────

interface DistrictAuditRow {
  total_vienna: string;
  has_district: string;
  missing_district: string;
}

async function reportDistrictAudit(sourceCode: string | null): Promise<void> {
  console.log('='.repeat(60));
  console.log('REPORT 2: District Inference Audit (Vienna)');
  console.log('='.repeat(60));

  const sourceFilter = sourceCode
    ? 'AND l.source_id = (SELECT id FROM sources WHERE code = $1)'
    : '';
  const params = sourceCode ? [sourceCode] : [];

  const rows = await query<DistrictAuditRow>(
    `SELECT
       COUNT(*) AS total_vienna,
       COUNT(l.district_no) AS has_district,
       COUNT(*) - COUNT(l.district_no) AS missing_district
     FROM listings l
     WHERE l.listing_status = 'active'
       AND l.city = 'Wien'
       ${sourceFilter}`,
    params,
  );

  const row = rows[0];
  if (!row || row.total_vienna === '0') {
    console.log('  No active Vienna listings found.\n');
    return;
  }

  const total = Number(row.total_vienna);
  const hasDistrict = Number(row.has_district);
  const missing = Number(row.missing_district);
  const rate = total > 0 ? ((hasDistrict / total) * 100).toFixed(1) : '0.0';

  console.log(`  Total Vienna listings:   ${total}`);
  console.log(`  With district_no:        ${hasDistrict}`);
  console.log(`  Missing district_no:     ${missing}`);
  console.log(`  Resolution rate:         ${rate}%`);
  console.log('');
}

// ── Report 3: Outlier Listings ──────────────────────────────────────────────

interface OutlierRow {
  id: string;
  title: string;
  district_no: number;
  price_per_sqm_eur: string;
  district_median: string;
  stddev_distance: string;
}

async function reportOutliers(sourceCode: string | null): Promise<void> {
  console.log('='.repeat(60));
  console.log('REPORT 3: Outlier Listings (>3 stddev from district median)');
  console.log('='.repeat(60));

  const sourceFilter = sourceCode
    ? 'AND l.source_id = (SELECT id FROM sources WHERE code = $1)'
    : '';
  const params = sourceCode ? [sourceCode] : [];

  const rows = await query<OutlierRow>(
    `WITH district_stats AS (
       SELECT
         district_no,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_sqm_eur) AS median_ppsqm,
         STDDEV_POP(price_per_sqm_eur) AS stddev_ppsqm
       FROM listings
       WHERE listing_status = 'active'
         AND price_per_sqm_eur IS NOT NULL
         AND district_no IS NOT NULL
       GROUP BY district_no
       HAVING COUNT(*) >= 3
     )
     SELECT
       l.id::text,
       l.title,
       l.district_no,
       l.price_per_sqm_eur::text,
       ds.median_ppsqm::text AS district_median,
       CASE
         WHEN ds.stddev_ppsqm > 0
         THEN (ABS(l.price_per_sqm_eur - ds.median_ppsqm) / ds.stddev_ppsqm)::text
         ELSE '0'
       END AS stddev_distance
     FROM listings l
     JOIN district_stats ds ON ds.district_no = l.district_no
     WHERE l.listing_status = 'active'
       AND l.price_per_sqm_eur IS NOT NULL
       AND ds.stddev_ppsqm > 0
       AND ABS(l.price_per_sqm_eur - ds.median_ppsqm) / ds.stddev_ppsqm > 3
       ${sourceFilter}
     ORDER BY ABS(l.price_per_sqm_eur - ds.median_ppsqm) / ds.stddev_ppsqm DESC
     LIMIT 10`,
    params,
  );

  if (rows.length === 0) {
    console.log('  No outlier listings found.\n');
    return;
  }

  console.log(
    `  ${'ID'.padEnd(8)} ${'District'.padEnd(10)} ${'Price/sqm'.padEnd(12)} ${'Median'.padEnd(12)} ${'Stddev'.padEnd(8)} Title`,
  );
  console.log(
    `  ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(30)}`,
  );

  for (const row of rows) {
    const ppsqm = Number(row.price_per_sqm_eur).toFixed(0);
    const median = Number(row.district_median).toFixed(0);
    const stddev = Number(row.stddev_distance).toFixed(1);
    const title = row.title.length > 40 ? row.title.slice(0, 37) + '...' : row.title;

    console.log(
      `  ${row.id.padEnd(8)} ${String(row.district_no).padEnd(10)} ${('EUR ' + ppsqm).padEnd(12)} ${('EUR ' + median).padEnd(12)} ${(stddev + 'x').padEnd(8)} ${title}`,
    );
  }
  console.log('');
}

// ── Report 4: Duplicate Candidates ──────────────────────────────────────────

interface DuplicateRow {
  cross_source_fingerprint: string;
  listing_count: string;
  source_codes: string;
  listing_ids: string;
  sample_title: string;
}

async function reportDuplicates(sourceCode: string | null): Promise<void> {
  console.log('='.repeat(60));
  console.log('REPORT 4: Duplicate Candidates (cross-source fingerprint)');
  console.log('='.repeat(60));

  const sourceFilter = sourceCode
    ? 'AND l.source_id = (SELECT id FROM sources WHERE code = $1)'
    : '';
  const params = sourceCode ? [sourceCode] : [];

  const rows = await query<DuplicateRow>(
    `SELECT
       l.cross_source_fingerprint,
       COUNT(*)::text AS listing_count,
       STRING_AGG(DISTINCT s.code, ', ') AS source_codes,
       STRING_AGG(l.id::text, ', ' ORDER BY l.id) AS listing_ids,
       MIN(l.title) AS sample_title
     FROM listings l
     JOIN sources s ON s.id = l.source_id
     WHERE l.listing_status = 'active'
       AND l.cross_source_fingerprint IS NOT NULL
       ${sourceFilter}
     GROUP BY l.cross_source_fingerprint
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC
     LIMIT 20`,
    params,
  );

  if (rows.length === 0) {
    console.log('  No duplicate candidates found.\n');
    return;
  }

  console.log(
    `  ${'Fingerprint'.padEnd(18)} ${'Count'.padEnd(7)} ${'Sources'.padEnd(30)} ${'IDs'.padEnd(20)} Title`,
  );
  console.log(
    `  ${'─'.repeat(18)} ${'─'.repeat(7)} ${'─'.repeat(30)} ${'─'.repeat(20)} ${'─'.repeat(30)}`,
  );

  for (const row of rows) {
    const fp = row.cross_source_fingerprint.slice(0, 16);
    const title =
      row.sample_title.length > 35 ? row.sample_title.slice(0, 32) + '...' : row.sample_title;
    const ids =
      row.listing_ids.length > 18 ? row.listing_ids.slice(0, 15) + '...' : row.listing_ids;

    console.log(
      `  ${fp.padEnd(18)} ${row.listing_count.padEnd(7)} ${row.source_codes.padEnd(30)} ${ids.padEnd(20)} ${title}`,
    );
  }
  console.log('');
}

// ── Gate Checks ──────────────────────────────────────────────────────────────

interface MaxMissingPctRow {
  source_code: string;
  max_missing_pct: string;
}

async function checkGates(sourceCode: string | null): Promise<GateResult[]> {
  const results: GateResult[] = [];

  // Gate 1: Missing field percentage per source
  const sourceFilter = sourceCode ? 'AND s.code = $1' : '';
  const params = sourceCode ? [sourceCode] : [];

  const missingRows = await query<MaxMissingPctRow>(
    `WITH field_counts AS (
       SELECT
         s.code AS source_code,
         COUNT(*) AS total,
         COUNT(*) FILTER (
           WHERE l.list_price_eur_cents IS NULL
              OR l.living_area_sqm IS NULL
              OR l.district_no IS NULL
              OR l.rooms IS NULL
         ) AS any_missing
       FROM listings l
       JOIN sources s ON s.id = l.source_id
       WHERE l.listing_status = 'active'
         ${sourceFilter}
       GROUP BY s.code
     )
     SELECT
       source_code,
       CASE WHEN total > 0 THEN (any_missing::numeric / total * 100)::text ELSE '0' END AS max_missing_pct
     FROM field_counts
     ORDER BY any_missing::numeric / GREATEST(total, 1) DESC
     LIMIT 1`,
    params,
  );

  const worstMissingPct = missingRows.length > 0 ? Number(missingRows[0]!.max_missing_pct) : 0;
  results.push({
    name: 'Missing critical fields (worst source)',
    passed: worstMissingPct <= GATE_THRESHOLDS.maxMissingFieldPct,
    actual: Math.round(worstMissingPct * 10) / 10,
    threshold: GATE_THRESHOLDS.maxMissingFieldPct,
    unit: '%',
  });

  // Gate 2: District resolution rate
  const districtRows = await query<{ has_district: string; total: string }>(
    `SELECT
       COUNT(l.district_no)::text AS has_district,
       COUNT(*)::text AS total
     FROM listings l
     WHERE l.listing_status = 'active'
       AND l.city = 'Wien'
       ${sourceFilter}`,
    params,
  );

  const districtRow = districtRows[0];
  const districtTotal = districtRow ? Number(districtRow.total) : 0;
  const districtResolved = districtRow ? Number(districtRow.has_district) : 0;
  const districtPct = districtTotal > 0 ? (districtResolved / districtTotal) * 100 : 100;
  results.push({
    name: 'Vienna district resolution rate',
    passed: districtPct >= GATE_THRESHOLDS.minDistrictResolutionPct,
    actual: Math.round(districtPct * 10) / 10,
    threshold: GATE_THRESHOLDS.minDistrictResolutionPct,
    unit: '%',
  });

  // Gate 3: Outlier count
  const outlierRows = await query<{ outlier_count: string }>(
    `WITH district_stats AS (
       SELECT
         district_no,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_sqm_eur) AS median_ppsqm,
         STDDEV_POP(price_per_sqm_eur) AS stddev_ppsqm
       FROM listings
       WHERE listing_status = 'active'
         AND price_per_sqm_eur IS NOT NULL
         AND district_no IS NOT NULL
       GROUP BY district_no
       HAVING COUNT(*) >= 3
     )
     SELECT COUNT(*)::text AS outlier_count
     FROM listings l
     JOIN district_stats ds ON ds.district_no = l.district_no
     WHERE l.listing_status = 'active'
       AND l.price_per_sqm_eur IS NOT NULL
       AND ds.stddev_ppsqm > 0
       AND ABS(l.price_per_sqm_eur - ds.median_ppsqm) / ds.stddev_ppsqm > 3
       ${sourceFilter}`,
    params,
  );

  const outlierCount = outlierRows.length > 0 ? Number(outlierRows[0]!.outlier_count) : 0;
  results.push({
    name: 'Extreme outlier count (>3 stddev)',
    passed: outlierCount <= GATE_THRESHOLDS.maxOutlierCount,
    actual: outlierCount,
    threshold: GATE_THRESHOLDS.maxOutlierCount,
    unit: 'listings',
  });

  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sourceCode, gate } = parseArgs();
  loadConfig();

  log.info('Starting data quality report', { sourceCode, gate });

  console.log('\n');
  console.log('DATA QUALITY REPORT');
  console.log(`Generated: ${new Date().toISOString()}`);
  if (sourceCode) {
    console.log(`Source filter: ${sourceCode}`);
  }
  if (gate) {
    console.log('Mode: GATE CHECK (exit non-zero on threshold breach)');
  }
  console.log('\n');

  await reportMissingFields(sourceCode);
  await reportDistrictAudit(sourceCode);
  await reportOutliers(sourceCode);
  await reportDuplicates(sourceCode);

  // ── Quality Gates ──────────────────────────────────────────────────
  if (gate) {
    console.log('='.repeat(60));
    console.log('QUALITY GATES');
    console.log('='.repeat(60));

    const gates = await checkGates(sourceCode);
    let allPassed = true;

    for (const g of gates) {
      const icon = g.passed ? 'PASS' : 'FAIL';
      console.log(
        `  [${icon}] ${g.name}: ${g.actual}${g.unit} (threshold: ${g.threshold}${g.unit})`,
      );
      if (!g.passed) allPassed = false;
    }

    console.log('');
    if (!allPassed) {
      console.log('RESULT: QUALITY GATE FAILED — one or more thresholds breached.\n');
      await closePool();
      process.exit(1);
    }
    console.log('RESULT: ALL QUALITY GATES PASSED.\n');
  } else {
    console.log('Report complete.\n');
  }

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
