import { query } from '../client.js';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface WienDevelopmentDbRow {
  id: string;
  external_key: string;
  name: string;
  status: string;
  description: string | null;
  category: string | null;
  latitude: string | null;
  longitude: string | null;
  geometry: Record<string, unknown> | null;
  source_url: string | null;
  properties: Record<string, unknown>;
  fetched_at: Date;
  created_at: Date;
}

export interface WienDevelopmentRow {
  id: number;
  externalKey: string;
  name: string;
  status: string;
  description: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry: Record<string, unknown> | null;
  sourceUrl: string | null;
  properties: Record<string, unknown>;
  fetchedAt: Date;
  createdAt: Date;
}

function toWienDevelopmentRow(row: WienDevelopmentDbRow): WienDevelopmentRow {
  return {
    id: Number(row.id),
    externalKey: row.external_key,
    name: row.name,
    status: row.status,
    description: row.description,
    category: row.category,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    geometry: row.geometry,
    sourceUrl: row.source_url,
    properties: row.properties,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
  };
}

// ── Input type ──────────────────────────────────────────────────────────────

export interface UpsertDevelopmentInput {
  externalKey: string;
  name: string;
  status?: string;
  description?: string | null;
  category?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: Record<string, unknown> | null;
  sourceUrl?: string | null;
  properties?: Record<string, unknown>;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Idempotent upsert on (external_key).
 */
export async function upsertDevelopment(
  input: UpsertDevelopmentInput,
): Promise<WienDevelopmentRow> {
  const rows = await query<WienDevelopmentDbRow>(
    `INSERT INTO wien_developments (
       external_key, name, status, description, category,
       latitude, longitude, geometry, source_url, properties,
       fetched_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (external_key) DO UPDATE SET
       name = EXCLUDED.name,
       status = EXCLUDED.status,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       geometry = EXCLUDED.geometry,
       source_url = EXCLUDED.source_url,
       properties = EXCLUDED.properties,
       fetched_at = NOW()
     RETURNING *`,
    [
      input.externalKey,
      input.name,
      input.status ?? 'unknown',
      input.description ?? null,
      input.category ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.geometry ? JSON.stringify(input.geometry) : null,
      input.sourceUrl ?? null,
      JSON.stringify(input.properties ?? {}),
    ],
  );
  return toWienDevelopmentRow(rows[0]!);
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Return all Wien developments.
 */
export async function findAll(): Promise<WienDevelopmentRow[]> {
  const rows = await query<WienDevelopmentDbRow>(`SELECT * FROM wien_developments ORDER BY name`);
  return rows.map(toWienDevelopmentRow);
}
