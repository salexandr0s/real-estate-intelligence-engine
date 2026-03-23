import { query } from '../client.js';
import type { PoiNearbyRow } from './pois.js';
import { findNearby } from './pois.js';

// ── Row types ──────────────────────────────────────────────────────────────

interface ListingPoiDbRow {
  id: string;
  listing_id: string;
  poi_id: string;
  category: string;
  poi_name: string;
  distance_m: string;
  rank: number;
  computed_at: Date;
}

export interface ListingPoiRow {
  id: number;
  listingId: number;
  poiId: number;
  category: string;
  poiName: string;
  distanceM: number;
  rank: number;
  computedAt: Date;
}

function toListingPoiRow(row: ListingPoiDbRow): ListingPoiRow {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    poiId: Number(row.poi_id),
    category: row.category,
    poiName: row.poi_name,
    distanceM: Number(row.distance_m),
    rank: row.rank,
    computedAt: row.computed_at,
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Cache the 2 closest POIs per category for a listing.
 * Upserts on (listing_id, category, rank) so re-scoring overwrites stale data.
 */
export async function cacheNearestPois(
  listingId: number,
  nearbyPois: PoiNearbyRow[],
): Promise<void> {
  // Sort by distance to ensure we always pick the 2 closest per category,
  // regardless of input order.
  const sorted = [...nearbyPois].sort((a, b) => a.distanceM - b.distanceM);
  const byCategory = new Map<string, PoiNearbyRow[]>();
  for (const poi of sorted) {
    const existing = byCategory.get(poi.category);
    if (existing) {
      if (existing.length < 2) existing.push(poi);
    } else {
      byCategory.set(poi.category, [poi]);
    }
  }

  const rows: {
    poiId: number;
    category: string;
    poiName: string;
    distanceM: number;
    rank: number;
  }[] = [];
  for (const [category, pois] of byCategory) {
    for (let i = 0; i < pois.length; i++) {
      rows.push({
        poiId: pois[i]!.id,
        category,
        poiName: pois[i]!.name,
        distanceM: pois[i]!.distanceM,
        rank: i + 1,
      });
    }
  }

  if (rows.length === 0) return;

  // Build a single multi-row upsert
  const values: unknown[] = [listingId];
  const placeholders: string[] = [];
  let paramIdx = 2;

  for (const row of rows) {
    placeholders.push(
      `($1, $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, NOW())`,
    );
    values.push(row.poiId, row.category, row.poiName, row.distanceM, row.rank);
    paramIdx += 5;
  }

  await query(
    `INSERT INTO listing_pois (listing_id, poi_id, category, poi_name, distance_m, rank, computed_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (listing_id, category, rank) DO UPDATE SET
       poi_id = EXCLUDED.poi_id,
       poi_name = EXCLUDED.poi_name,
       distance_m = EXCLUDED.distance_m,
       computed_at = EXCLUDED.computed_at`,
    values,
  );
}

/**
 * Compute and cache nearest POIs for a listing in one step.
 * Calls findNearby (Haversine) then caches the top 2 per category.
 */
export async function computeAndCache(
  listingId: number,
  latitude: number,
  longitude: number,
): Promise<void> {
  const nearby = await findNearby(latitude, longitude, 2000);
  await cacheNearestPois(listingId, nearby);
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Get cached nearest POIs for a listing, ordered by category then rank.
 */
export async function getByListingId(listingId: number): Promise<ListingPoiRow[]> {
  const rows = await query<ListingPoiDbRow>(
    `SELECT * FROM listing_pois
     WHERE listing_id = $1
     ORDER BY category, rank`,
    [listingId],
  );
  return rows.map(toListingPoiRow);
}
