import { query } from '../client.js';

/**
 * Comparable listing for market analysis.
 * Used to build market context (sale comps) and market rent estimates.
 */
export interface ComparableDbRow {
  id: string;
  title: string;
  district_no: number | null;
  operation_type: string;
  property_type: string;
  list_price_eur_cents: string | null;
  price_per_sqm_eur: string | null;
  living_area_sqm: string | null;
  rooms: string | null;
  latitude: string | null;
  longitude: string | null;
  first_seen_at: Date;
  canonical_url: string;
  distance_m: string | null;
}

export interface ComparableResult {
  listingId: number;
  title: string;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  listPriceEurCents: number | null;
  pricePerSqmEur: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  distanceM: number | null;
  firstSeenAt: Date;
  canonicalUrl: string;
}

function toComparableResult(row: ComparableDbRow): ComparableResult {
  return {
    listingId: Number(row.id),
    title: row.title,
    districtNo: row.district_no,
    operationType: row.operation_type,
    propertyType: row.property_type,
    listPriceEurCents: row.list_price_eur_cents != null ? Number(row.list_price_eur_cents) : null,
    pricePerSqmEur: row.price_per_sqm_eur != null ? Number(row.price_per_sqm_eur) : null,
    livingAreaSqm: row.living_area_sqm != null ? Number(row.living_area_sqm) : null,
    rooms: row.rooms != null ? Number(row.rooms) : null,
    distanceM: row.distance_m != null ? Number(row.distance_m) : null,
    firstSeenAt: row.first_seen_at,
    canonicalUrl: row.canonical_url,
  };
}

/**
 * Tier 1: Nearby comparables within a radius.
 * Same operation_type + property_type, similar area (±30%), similar rooms (±1),
 * geocode_precision in (source_exact, source_approx, street), seen in last N days.
 */
export async function findNearbyComparables(params: {
  listingId: number;
  latitude: number;
  longitude: number;
  operationType: string;
  propertyType: string;
  livingAreaSqm: number | null;
  rooms: number | null;
  radiusM?: number;
  maxAgeDays?: number;
  limit?: number;
}): Promise<ComparableResult[]> {
  const radiusM = params.radiusM ?? 500;
  const maxAgeDays = params.maxAgeDays ?? 90;
  const limit = params.limit ?? 20;

  // Area tolerance: ±30%
  const areaLow = params.livingAreaSqm != null ? params.livingAreaSqm * 0.7 : null;
  const areaHigh = params.livingAreaSqm != null ? params.livingAreaSqm * 1.3 : null;

  // Room tolerance: ±1
  const roomLow = params.rooms != null ? params.rooms - 1 : null;
  const roomHigh = params.rooms != null ? params.rooms + 1 : null;

  const rows = await query<ComparableDbRow>(
    `SELECT
       l.id, l.title, l.district_no, l.operation_type, l.property_type,
       l.list_price_eur_cents, l.price_per_sqm_eur,
       l.living_area_sqm, l.rooms,
       l.latitude, l.longitude, l.first_seen_at, l.canonical_url,
       ROUND(
         6371000 * acos(
           LEAST(1.0, cos(radians($1)) * cos(radians(l.latitude))
             * cos(radians(l.longitude) - radians($2))
             + sin(radians($1)) * sin(radians(l.latitude)))
         )
       ) AS distance_m
     FROM listings l
     WHERE l.id != $3
       AND l.listing_status = 'active'
       AND l.operation_type = $4
       AND l.property_type = $5
       AND l.latitude IS NOT NULL
       AND l.longitude IS NOT NULL
       AND l.price_per_sqm_eur IS NOT NULL
       AND l.geocode_precision IN ('source_exact', 'source_approx', 'street')
       AND l.first_seen_at >= NOW() - make_interval(days => $6)
       AND ($7::numeric IS NULL OR l.living_area_sqm BETWEEN $7 AND $8)
       AND ($9::numeric IS NULL OR l.rooms BETWEEN $9 AND $10)
       AND 6371000 * acos(
         LEAST(1.0, cos(radians($1)) * cos(radians(l.latitude))
           * cos(radians(l.longitude) - radians($2))
           + sin(radians($1)) * sin(radians(l.latitude)))
       ) <= $11
     ORDER BY distance_m ASC
     LIMIT $12`,
    [
      params.latitude, // $1
      params.longitude, // $2
      params.listingId, // $3
      params.operationType, // $4
      params.propertyType, // $5
      maxAgeDays, // $6
      areaLow, // $7
      areaHigh, // $8
      roomLow, // $9
      roomHigh, // $10
      radiusM, // $11
      limit, // $12
    ],
  );

  return rows.map(toComparableResult);
}

/**
 * Tier 2: District-level comparables.
 * Same district, operation_type, property_type, similar area, wider time window.
 */
export async function findDistrictComparables(params: {
  listingId: number;
  districtNo: number;
  operationType: string;
  propertyType: string;
  livingAreaSqm: number | null;
  maxAgeDays?: number;
  limit?: number;
}): Promise<ComparableResult[]> {
  const maxAgeDays = params.maxAgeDays ?? 180;
  const limit = params.limit ?? 20;

  const areaLow = params.livingAreaSqm != null ? params.livingAreaSqm * 0.7 : null;
  const areaHigh = params.livingAreaSqm != null ? params.livingAreaSqm * 1.3 : null;

  const rows = await query<ComparableDbRow>(
    `SELECT
       l.id, l.title, l.district_no, l.operation_type, l.property_type,
       l.list_price_eur_cents, l.price_per_sqm_eur,
       l.living_area_sqm, l.rooms,
       l.latitude, l.longitude, l.first_seen_at, l.canonical_url,
       NULL::numeric AS distance_m
     FROM listings l
     WHERE l.id != $1
       AND l.listing_status = 'active'
       AND l.district_no = $2
       AND l.operation_type = $3
       AND l.property_type = $4
       AND l.price_per_sqm_eur IS NOT NULL
       AND l.first_seen_at >= NOW() - make_interval(days => $5)
       AND ($6::numeric IS NULL OR l.living_area_sqm BETWEEN $6 AND $7)
     ORDER BY l.first_seen_at DESC
     LIMIT $8`,
    [
      params.listingId, // $1
      params.districtNo, // $2
      params.operationType, // $3
      params.propertyType, // $4
      maxAgeDays, // $5
      areaLow, // $6
      areaHigh, // $7
      limit, // $8
    ],
  );

  return rows.map(toComparableResult);
}
