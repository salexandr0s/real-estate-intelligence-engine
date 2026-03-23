import { query } from '../client.js';

// ── Row types ───────────────────────────────────────────────────────────────

interface BuildingFactDbRow {
  id: string;
  building_key: string;
  source_name: string;
  source_record_id: string | null;
  address_text: string | null;
  lat: string | null;
  lon: string | null;
  match_confidence: string;
  facts_json: Record<string, unknown>;
  source_updated_at: Date | null;
  ingested_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface BuildingFactRow {
  id: number;
  buildingKey: string;
  sourceName: string;
  sourceRecordId: string | null;
  addressText: string | null;
  lat: number | null;
  lon: number | null;
  matchConfidence: string;
  factsJson: Record<string, unknown>;
  sourceUpdatedAt: Date | null;
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toBuildingFactRow(row: BuildingFactDbRow): BuildingFactRow {
  return {
    id: Number(row.id),
    buildingKey: row.building_key,
    sourceName: row.source_name,
    sourceRecordId: row.source_record_id,
    addressText: row.address_text,
    lat: row.lat != null ? Number(row.lat) : null,
    lon: row.lon != null ? Number(row.lon) : null,
    matchConfidence: row.match_confidence,
    factsJson: row.facts_json,
    sourceUpdatedAt: row.source_updated_at,
    ingestedAt: row.ingested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

export interface UpsertBuildingFactInput {
  buildingKey: string;
  sourceName: string;
  sourceRecordId?: string | null;
  addressText?: string | null;
  lat?: number | null;
  lon?: number | null;
  matchConfidence?: string;
  factsJson: Record<string, unknown>;
  sourceUpdatedAt?: Date | null;
}

export async function upsertBuildingFact(input: UpsertBuildingFactInput): Promise<BuildingFactRow> {
  const rows = await query<BuildingFactDbRow>(
    `INSERT INTO building_facts (
       building_key, source_name, source_record_id,
       address_text, lat, lon,
       match_confidence, facts_json, source_updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (building_key, source_name) DO UPDATE SET
       source_record_id = EXCLUDED.source_record_id,
       address_text = EXCLUDED.address_text,
       lat = EXCLUDED.lat,
       lon = EXCLUDED.lon,
       match_confidence = EXCLUDED.match_confidence,
       facts_json = EXCLUDED.facts_json,
       source_updated_at = EXCLUDED.source_updated_at,
       updated_at = NOW()
     RETURNING *`,
    [
      input.buildingKey,
      input.sourceName,
      input.sourceRecordId ?? null,
      input.addressText ?? null,
      input.lat ?? null,
      input.lon ?? null,
      input.matchConfidence ?? 'unknown',
      JSON.stringify(input.factsJson),
      input.sourceUpdatedAt ?? null,
    ],
  );
  return toBuildingFactRow(rows[0]!);
}

export async function findById(id: number): Promise<BuildingFactRow | null> {
  const rows = await query<BuildingFactDbRow>('SELECT * FROM building_facts WHERE id = $1', [id]);
  return rows[0] ? toBuildingFactRow(rows[0]) : null;
}

export async function findByBuildingKey(buildingKey: string): Promise<BuildingFactRow[]> {
  const rows = await query<BuildingFactDbRow>(
    'SELECT * FROM building_facts WHERE building_key = $1',
    [buildingKey],
  );
  return rows.map(toBuildingFactRow);
}

/**
 * Find nearest building fact within a radius using Haversine distance.
 */
export async function findNearestBuilding(
  lat: number,
  lon: number,
  radiusM?: number,
): Promise<BuildingFactRow | null> {
  const radius = radiusM ?? 50;
  const rows = await query<BuildingFactDbRow>(
    `SELECT *,
       6371000 * acos(
         LEAST(1.0, cos(radians($1)) * cos(radians(lat))
           * cos(radians(lon) - radians($2))
           + sin(radians($1)) * sin(radians(lat)))
       ) AS dist_m
     FROM building_facts
     WHERE lat IS NOT NULL AND lon IS NOT NULL
       AND 6371000 * acos(
         LEAST(1.0, cos(radians($1)) * cos(radians(lat))
           * cos(radians(lon) - radians($2))
           + sin(radians($1)) * sin(radians(lat)))
       ) <= $3
     ORDER BY dist_m ASC
     LIMIT 1`,
    [lat, lon, radius],
  );
  return rows[0] ? toBuildingFactRow(rows[0]) : null;
}
