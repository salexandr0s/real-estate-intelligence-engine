#!/usr/bin/env npx tsx
/**
 * Baseline computation script.
 *
 * Aggregates active listings into market_baselines for scoring.
 * Groups by (city, district_no, operation_type, property_type, area_bucket, room_bucket).
 * Also computes city-wide baselines (district_no = NULL) for broader fallback.
 *
 * Usage:
 *   npx tsx scripts/compute-baselines.ts
 */

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import { getAreaBucket, getRoomBucket } from '@immoradar/contracts';
import { query, marketBaselines, closePool } from '@immoradar/db';

const log = createLogger('baselines-cli');

// ── Types ───────────────────────────────────────────────────────────────────

interface ListingAggRow {
  city: string;
  district_no: number | null;
  operation_type: string;
  property_type: string;
  price_per_sqm_eur: string;
  living_area_sqm: string | null;
  rooms: string | null;
}

interface BucketGroup {
  city: string;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  areaBucket: string;
  roomBucket: string;
  values: number[];
}

// ── Stats helpers ───────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function stddev(values: number[], mean: number): number {
  const sumSqDiff = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sumSqDiff / values.length);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadConfig();

  log.info('Computing market baselines...');

  // 1. Query active listings with price data
  const rows = await query<ListingAggRow>(
    `SELECT
       city,
       district_no,
       operation_type,
       property_type,
       price_per_sqm_eur,
       living_area_sqm,
       rooms
     FROM listings
     WHERE listing_status = 'active'
       AND price_per_sqm_eur IS NOT NULL`,
  );

  log.info(`Fetched ${rows.length} active listings with price data`);

  if (rows.length === 0) {
    log.warn('No listings found. Run scrape-and-ingest first.');
    await closePool();
    return;
  }

  // 2. Group by (city, district_no, operation_type, property_type, area_bucket, room_bucket)
  const groupKey = (
    city: string,
    districtNo: number | null,
    operationType: string,
    propertyType: string,
    areaBucket: string,
    roomBucket: string,
  ): string =>
    `${city}|${districtNo ?? 'NULL'}|${operationType}|${propertyType}|${areaBucket}|${roomBucket}`;

  const districtGroups = new Map<string, BucketGroup>();
  const cityGroups = new Map<string, BucketGroup>();

  for (const row of rows) {
    const ppsqm = Number(row.price_per_sqm_eur);
    if (isNaN(ppsqm) || ppsqm <= 0) continue;

    const areaSqm = row.living_area_sqm != null ? Number(row.living_area_sqm) : null;
    const rooms = row.rooms != null ? Number(row.rooms) : null;
    const areaBucket = getAreaBucket(areaSqm);
    const roomBucket = getRoomBucket(rooms);

    // District-level group
    const dKey = groupKey(
      row.city,
      row.district_no,
      row.operation_type,
      row.property_type,
      areaBucket,
      roomBucket,
    );
    if (!districtGroups.has(dKey)) {
      districtGroups.set(dKey, {
        city: row.city,
        districtNo: row.district_no,
        operationType: row.operation_type,
        propertyType: row.property_type,
        areaBucket,
        roomBucket,
        values: [],
      });
    }
    districtGroups.get(dKey)!.values.push(ppsqm);

    // City-wide group (district_no = null)
    const cKey = groupKey(
      row.city,
      null,
      row.operation_type,
      row.property_type,
      areaBucket,
      roomBucket,
    );
    if (!cityGroups.has(cKey)) {
      cityGroups.set(cKey, {
        city: row.city,
        districtNo: null,
        operationType: row.operation_type,
        propertyType: row.property_type,
        areaBucket,
        roomBucket,
        values: [],
      });
    }
    cityGroups.get(cKey)!.values.push(ppsqm);
  }

  // 3. Compute and upsert baselines
  const baselineDate = new Date();
  let upserted = 0;
  let skippedSmall = 0;

  const allGroups = [...districtGroups.values(), ...cityGroups.values()];

  for (const group of allGroups) {
    // Require minimum 3 listings for a meaningful baseline
    if (group.values.length < 3) {
      skippedSmall++;
      continue;
    }

    const sorted = group.values.slice().sort((a, b) => a - b);
    const med = median(sorted);
    const p25 = percentile(sorted, 25);
    const p75 = percentile(sorted, 75);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const sd = stddev(sorted, mean);

    // Trimmed mean (10% trim)
    const trimCount = Math.floor(sorted.length * 0.1);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const trimmedMean =
      trimmed.length > 0 ? trimmed.reduce((a, b) => a + b, 0) / trimmed.length : mean;

    await marketBaselines.upsertBaseline({
      baselineDate,
      city: group.city,
      districtNo: group.districtNo,
      operationType: group.operationType,
      propertyType: group.propertyType,
      areaBucket: group.areaBucket,
      roomBucket: group.roomBucket,
      sampleSize: group.values.length,
      medianPpsqmEur: Math.round(med * 100) / 100,
      trimmedMeanPpsqmEur: Math.round(trimmedMean * 100) / 100,
      p25PpsqmEur: Math.round(p25 * 100) / 100,
      p75PpsqmEur: Math.round(p75 * 100) / 100,
      stddevPpsqmEur: Math.round(sd * 100) / 100,
    });

    upserted++;
  }

  // 4. Summary
  console.log('\n=== Baseline Summary ===');
  console.log(`Active listings:     ${rows.length}`);
  console.log(`District groups:     ${districtGroups.size}`);
  console.log(`City-wide groups:    ${cityGroups.size}`);
  console.log(`Baselines upserted:  ${upserted}`);
  console.log(`Skipped (< 3 items): ${skippedSmall}`);
  console.log('========================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
