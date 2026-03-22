import { query } from '../client.js';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface PoiDbRow {
  id: string;
  source_id: string;
  external_key: string;
  category: string;
  subcategory: string | null;
  name: string;
  latitude: string;
  longitude: string;
  district_no: number | null;
  properties: Record<string, unknown>;
  created_at: Date;
}

interface PoiNearbyDbRow extends PoiDbRow {
  distance_m: string;
}

export interface PoiRow {
  id: number;
  sourceId: string;
  externalKey: string;
  category: string;
  subcategory: string | null;
  name: string;
  latitude: number;
  longitude: number;
  districtNo: number | null;
  properties: Record<string, unknown>;
  createdAt: Date;
}

export interface PoiNearbyRow extends PoiRow {
  distanceM: number;
}

function toPoiRow(row: PoiDbRow): PoiRow {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    externalKey: row.external_key,
    category: row.category,
    subcategory: row.subcategory,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    districtNo: row.district_no,
    properties: row.properties,
    createdAt: row.created_at,
  };
}

function toPoiNearbyRow(row: PoiNearbyDbRow): PoiNearbyRow {
  return {
    ...toPoiRow(row),
    distanceM: Number(row.distance_m),
  };
}

// ── Input type ──────────────────────────────────────────────────────────────

export interface UpsertPoiInput {
  sourceId: string;
  externalKey: string;
  category: string;
  subcategory?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  districtNo?: number | null;
  properties?: Record<string, unknown>;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Idempotent upsert on (source_id, external_key).
 */
export async function upsertPoi(input: UpsertPoiInput): Promise<PoiRow> {
  const rows = await query<PoiDbRow>(
    `INSERT INTO pois (
       source_id, external_key, category, subcategory,
       name, latitude, longitude, district_no, properties
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (source_id, external_key) DO UPDATE SET
       category = EXCLUDED.category,
       subcategory = EXCLUDED.subcategory,
       name = EXCLUDED.name,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       district_no = EXCLUDED.district_no,
       properties = EXCLUDED.properties
     RETURNING *`,
    [
      input.sourceId,
      input.externalKey,
      input.category,
      input.subcategory ?? null,
      input.name,
      input.latitude,
      input.longitude,
      input.districtNo ?? null,
      JSON.stringify(input.properties ?? {}),
    ],
  );
  return toPoiRow(rows[0]!);
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Find POIs within a given radius (meters) of a point using Haversine distance
 * with a bounding-box pre-filter for performance.
 */
export async function findNearby(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  categories?: string[],
): Promise<PoiNearbyRow[]> {
  const rows = await query<PoiNearbyDbRow>(
    `SELECT *,
       (6371000 * acos(LEAST(1.0,
         cos(radians($1)) * cos(radians(latitude)) *
         cos(radians(longitude) - radians($2)) +
         sin(radians($1)) * sin(radians(latitude))
       ))) AS distance_m
     FROM pois
     WHERE latitude BETWEEN $1 - ($3::numeric / 111320.0) AND $1 + ($3::numeric / 111320.0)
       AND longitude BETWEEN $2 - ($3::numeric / (111320.0 * cos(radians($1)))) AND $2 + ($3::numeric / (111320.0 * cos(radians($1))))
       AND ($4::text[] IS NULL OR category = ANY($4))
     HAVING (6371000 * acos(LEAST(1.0,
         cos(radians($1)) * cos(radians(latitude)) *
         cos(radians(longitude) - radians($2)) +
         sin(radians($1)) * sin(radians(latitude))
       ))) <= $3
     ORDER BY distance_m`,
    [latitude, longitude, radiusMeters, categories && categories.length > 0 ? categories : null],
  );
  return rows.map(toPoiNearbyRow);
}

/**
 * Return all POIs, optionally filtered by categories.
 */
export async function findAll(categories?: string[]): Promise<PoiRow[]> {
  const rows = await query<PoiDbRow>(
    `SELECT * FROM pois
     WHERE ($1::text[] IS NULL OR category = ANY($1))
     ORDER BY category, name`,
    [categories && categories.length > 0 ? categories : null],
  );
  return rows.map(toPoiRow);
}
