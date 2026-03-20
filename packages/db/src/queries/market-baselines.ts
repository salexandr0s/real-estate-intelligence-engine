import { query } from '../client.js';

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
    trimmedMeanPpsqmEur: row.trimmed_mean_ppsqm_eur != null ? Number(row.trimmed_mean_ppsqm_eur) : null,
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

/**
 * Find a baseline with progressive fallbacks:
 *
 * 1. Exact match: district + type + area_bucket + room_bucket
 * 2. District + type only (any bucket)
 * 3. City-wide + type + area_bucket + room_bucket
 * 4. City-wide + type only
 *
 * Returns the best match and which fallback level was used.
 */
export async function findBaselineWithFallback(params: {
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  areaBucket: string;
  roomBucket: string;
  city?: string;
}): Promise<{
  baseline: MarketBaselineRow | null;
  fallbackLevel: 'district_bucket' | 'district_type' | 'city_bucket' | 'city_type' | 'none';
}> {
  const city = params.city ?? 'Wien';

  // Level 1: Exact district + bucket match
  if (params.districtNo != null) {
    const exact = await findBaseline(
      params.districtNo,
      params.operationType,
      params.propertyType,
      params.areaBucket,
      params.roomBucket,
    );
    if (exact) {
      return { baseline: exact, fallbackLevel: 'district_bucket' };
    }

    // Level 2: District + type (ignore buckets -- take the one with largest sample)
    const districtType = await query<MarketBaselineDbRow>(
      `SELECT * FROM market_baselines
       WHERE district_no = $1
         AND operation_type = $2
         AND property_type = $3
         AND city = $4
       ORDER BY sample_size DESC, baseline_date DESC
       LIMIT 1`,
      [params.districtNo, params.operationType, params.propertyType, city],
    );
    if (districtType[0]) {
      return { baseline: toMarketBaselineRow(districtType[0]), fallbackLevel: 'district_type' };
    }
  }

  // Level 3: City-wide + bucket match (district_no IS NULL)
  const cityBucket = await findBaseline(
    null,
    params.operationType,
    params.propertyType,
    params.areaBucket,
    params.roomBucket,
  );
  if (cityBucket) {
    return { baseline: cityBucket, fallbackLevel: 'city_bucket' };
  }

  // Level 4: City-wide + type only (ignore buckets)
  const cityType = await query<MarketBaselineDbRow>(
    `SELECT * FROM market_baselines
     WHERE district_no IS NULL
       AND operation_type = $1
       AND property_type = $2
       AND city = $3
     ORDER BY sample_size DESC, baseline_date DESC
     LIMIT 1`,
    [params.operationType, params.propertyType, city],
  );
  if (cityType[0]) {
    return { baseline: toMarketBaselineRow(cityType[0]), fallbackLevel: 'city_type' };
  }

  return { baseline: null, fallbackLevel: 'none' };
}
