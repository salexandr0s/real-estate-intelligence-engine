import type { BaselineLookup } from '@immoradar/contracts';
import { query } from '../client.js';

/** Bucket value of the rows that cover every area and room count. */
export const ALL_BUCKETS = 'all';

const DEFAULT_CITY = 'Wien';

// ── Row types ───────────────────────────────────────────────────────────────

export interface MarketBaselineRow {
  id: number;
  baselineDate: Date;
  city: string;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  areaBucket: string;
  roomBucket: string;
  sourceScope: string;
  sampleSize: number;
  medianPpsqmEur: number;
  trimmedMeanPpsqmEur: number | null;
  p25PpsqmEur: number | null;
  p75PpsqmEur: number | null;
  stddevPpsqmEur: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MarketBaselineDbRow {
  id: string;
  baseline_date: Date;
  city: string;
  district_no: number | null;
  operation_type: string;
  property_type: string;
  area_bucket: string;
  room_bucket: string;
  source_scope: string;
  sample_size: number;
  median_ppsqm_eur: string;
  trimmed_mean_ppsqm_eur: string | null;
  p25_ppsqm_eur: string | null;
  p75_ppsqm_eur: string | null;
  stddev_ppsqm_eur: string | null;
  created_at: Date;
  updated_at: Date;
}

function toMarketBaselineRow(row: MarketBaselineDbRow): MarketBaselineRow {
  return {
    id: Number(row.id),
    baselineDate: row.baseline_date,
    city: row.city,
    districtNo: row.district_no,
    operationType: row.operation_type,
    propertyType: row.property_type,
    areaBucket: row.area_bucket,
    roomBucket: row.room_bucket,
    sourceScope: row.source_scope,
    sampleSize: row.sample_size,
    medianPpsqmEur: Number(row.median_ppsqm_eur),
    trimmedMeanPpsqmEur:
      row.trimmed_mean_ppsqm_eur != null ? Number(row.trimmed_mean_ppsqm_eur) : null,
    p25PpsqmEur: row.p25_ppsqm_eur != null ? Number(row.p25_ppsqm_eur) : null,
    p75PpsqmEur: row.p75_ppsqm_eur != null ? Number(row.p75_ppsqm_eur) : null,
    stddevPpsqmEur: row.stddev_ppsqm_eur != null ? Number(row.stddev_ppsqm_eur) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export interface UpsertBaselineInput {
  baselineDate: Date;
  city: string;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  areaBucket: string;
  roomBucket: string;
  sourceScope?: string;
  sampleSize: number;
  medianPpsqmEur: number;
  trimmedMeanPpsqmEur?: number | null;
  p25PpsqmEur?: number | null;
  p75PpsqmEur?: number | null;
  stddevPpsqmEur?: number | null;
}

/**
 * Upsert a market baseline on the composite unique key
 * (baseline_date, city, district_no, operation_type, property_type,
 *  area_bucket, room_bucket, source_scope).
 * The key treats a NULL district_no as equal to another NULL (migration 027),
 * so a city-wide row updates in place like a district row.
 */
export async function upsertBaseline(input: UpsertBaselineInput): Promise<MarketBaselineRow> {
  const rows = await query<MarketBaselineDbRow>(
    `INSERT INTO market_baselines (
       baseline_date, city, district_no,
       operation_type, property_type,
       area_bucket, room_bucket, source_scope,
       sample_size, median_ppsqm_eur,
       trimmed_mean_ppsqm_eur, p25_ppsqm_eur, p75_ppsqm_eur, stddev_ppsqm_eur
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (baseline_date, city, district_no, operation_type, property_type, area_bucket, room_bucket, source_scope)
     DO UPDATE SET
       sample_size = EXCLUDED.sample_size,
       median_ppsqm_eur = EXCLUDED.median_ppsqm_eur,
       trimmed_mean_ppsqm_eur = EXCLUDED.trimmed_mean_ppsqm_eur,
       p25_ppsqm_eur = EXCLUDED.p25_ppsqm_eur,
       p75_ppsqm_eur = EXCLUDED.p75_ppsqm_eur,
       stddev_ppsqm_eur = EXCLUDED.stddev_ppsqm_eur
     RETURNING *`,
    [
      input.baselineDate,
      input.city,
      input.districtNo,
      input.operationType,
      input.propertyType,
      input.areaBucket,
      input.roomBucket,
      input.sourceScope ?? 'all_sources',
      input.sampleSize,
      input.medianPpsqmEur,
      input.trimmedMeanPpsqmEur ?? null,
      input.p25PpsqmEur ?? null,
      input.p75PpsqmEur ?? null,
      input.stddevPpsqmEur ?? null,
    ],
  );
  return toMarketBaselineRow(rows[0]!);
}

/**
 * Find an exact baseline match for a specific combination of dimensions.
 */
export async function findBaseline(
  districtNo: number | null,
  operationType: string,
  propertyType: string,
  areaBucket: string,
  roomBucket: string,
): Promise<MarketBaselineRow | null> {
  const rows = await query<MarketBaselineDbRow>(
    `SELECT * FROM market_baselines
     WHERE ($1::smallint IS NULL AND district_no IS NULL OR district_no = $1)
       AND operation_type = $2
       AND property_type = $3
       AND area_bucket = $4
       AND room_bucket = $5
     ORDER BY baseline_date DESC
     LIMIT 1`,
    [districtNo, operationType, propertyType, areaBucket, roomBucket],
  );
  const row = rows[0];
  return row ? toMarketBaselineRow(row) : null;
}

export type BaselineFallbackLevel = BaselineLookup['fallbackLevel'];

export interface BaselineQuery {
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  areaBucket: string;
  roomBucket: string;
  city?: string;
}

function fallbackLevelOf(row: MarketBaselineRow): Exclude<BaselineFallbackLevel, 'none'> {
  const allBuckets = row.areaBucket === ALL_BUCKETS;
  if (row.districtNo != null) return allBuckets ? 'district_type' : 'district_bucket';
  return allBuckets ? 'city_type' : 'city_bucket';
}

/**
 * The bucket baseline: the most specific row of the newest baseline date that has one. A row
 * from an older run loses to a newer, broader one, because the listings behind it may be gone.
 * Within one date the order is:
 *
 * 1. district_bucket: the district's row for the listing's area and room buckets
 * 2. district_type: the district's row for all buckets
 * 3. city_bucket: the city-wide row for the listing's buckets
 * 4. city_type: the city-wide row for all buckets
 *
 * Returns the row and the level it matched.
 */
export async function findBaselineWithFallback(params: BaselineQuery): Promise<{
  baseline: MarketBaselineRow | null;
  fallbackLevel: BaselineFallbackLevel;
}> {
  // A NULL district matches no district row, so only the city-wide levels remain.
  const rows = await query<MarketBaselineDbRow>(
    `SELECT * FROM market_baselines
     WHERE city = $1
       AND operation_type = $2
       AND property_type = $3
       AND source_scope = 'all_sources'
       AND (district_no = $4 OR district_no IS NULL)
       AND ((area_bucket = $5 AND room_bucket = $6) OR (area_bucket = $7 AND room_bucket = $7))
     ORDER BY baseline_date DESC, district_no IS NULL, area_bucket = $7, id DESC
     LIMIT 1`,
    [
      params.city ?? DEFAULT_CITY,
      params.operationType,
      params.propertyType,
      params.districtNo,
      params.areaBucket,
      params.roomBucket,
      ALL_BUCKETS,
    ],
  );
  const row = rows[0];
  if (!row) return { baseline: null, fallbackLevel: 'none' };
  const baseline = toMarketBaselineRow(row);
  return { baseline, fallbackLevel: fallbackLevelOf(baseline) };
}

/**
 * The district's all-bucket row of the newest baseline date, or the city-wide one when the
 * district has none on that date.
 */
async function findDistrictMedianBaseline(
  params: BaselineQuery,
): Promise<MarketBaselineRow | null> {
  const rows = await query<MarketBaselineDbRow>(
    `SELECT * FROM market_baselines
     WHERE city = $1
       AND operation_type = $2
       AND property_type = $3
       AND source_scope = 'all_sources'
       AND (district_no = $4 OR district_no IS NULL)
       AND area_bucket = $5
       AND room_bucket = $5
     ORDER BY baseline_date DESC, district_no IS NULL, id DESC
     LIMIT 1`,
    [
      params.city ?? DEFAULT_CITY,
      params.operationType,
      params.propertyType,
      params.districtNo,
      ALL_BUCKETS,
    ],
  );
  const row = rows[0];
  return row ? toMarketBaselineRow(row) : null;
}

/**
 * The two medians a score compares a listing with. The district median comes from the
 * district's all-bucket row and the bucket median from findBaselineWithFallback, so the
 * district price score and the undervaluation score each measure their own discount. They
 * share a row only when no bucket-specific row exists.
 */
export async function findScoringBaselines(params: BaselineQuery): Promise<BaselineLookup> {
  const bucket = await findBaselineWithFallback(params);
  const district = await findDistrictMedianBaseline(params);
  return {
    districtBaselinePpsqmEur: district?.medianPpsqmEur ?? null,
    bucketBaselinePpsqmEur: bucket.baseline?.medianPpsqmEur ?? null,
    bucketSampleSize: bucket.baseline?.sampleSize ?? 0,
    fallbackLevel: bucket.fallbackLevel,
  };
}

/** Find the most recent baseline_date across all baselines. */
export async function findLatestBaselineDate(): Promise<Date | null> {
  const rows = await query<{ latest: Date | null }>(
    `SELECT MAX(baseline_date) AS latest FROM market_baselines`,
  );
  return rows[0]?.latest ?? null;
}
