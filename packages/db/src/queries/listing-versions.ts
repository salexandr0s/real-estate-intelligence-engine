import { query } from '../client.js';
import type { VersionReason, ListingStatus } from '@rei/contracts';

// ── Row types ───────────────────────────────────────────────────────────────

export interface ListingVersionRow {
  id: number;
  listingId: number;
  rawListingId: number;
  versionNo: number;
  versionReason: VersionReason;
  contentFingerprint: string;
  listingStatus: ListingStatus;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  pricePerSqmEur: number | null;
  normalizedSnapshot: Record<string, unknown>;
  observedAt: Date;
  createdAt: Date;
}

interface ListingVersionDbRow {
  id: string;
  listing_id: string;
  raw_listing_id: string;
  version_no: number;
  version_reason: VersionReason;
  content_fingerprint: string;
  listing_status: ListingStatus;
  list_price_eur_cents: string | null;
  living_area_sqm: string | null;
  price_per_sqm_eur: string | null;
  normalized_snapshot: Record<string, unknown>;
  observed_at: Date;
  created_at: Date;
}

function toListingVersionRow(row: ListingVersionDbRow): ListingVersionRow {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    rawListingId: Number(row.raw_listing_id),
    versionNo: row.version_no,
    versionReason: row.version_reason,
    contentFingerprint: row.content_fingerprint,
    listingStatus: row.listing_status,
    listPriceEurCents: row.list_price_eur_cents != null ? Number(row.list_price_eur_cents) : null,
    livingAreaSqm: row.living_area_sqm != null ? Number(row.living_area_sqm) : null,
    pricePerSqmEur: row.price_per_sqm_eur != null ? Number(row.price_per_sqm_eur) : null,
    normalizedSnapshot: row.normalized_snapshot,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export interface AppendVersionInput {
  listingId: number;
  rawListingId: number;
  versionReason: VersionReason;
  contentFingerprint: string;
  listingStatus: ListingStatus;
  listPriceEurCents?: number | null;
  livingAreaSqm?: number | null;
  pricePerSqmEur?: number | null;
  normalizedSnapshot: Record<string, unknown>;
  observedAt?: Date;
}

/**
 * Append a new version to a listing's history.
 * version_no is auto-incremented per listing_id using a subquery.
 */
export async function appendVersion(input: AppendVersionInput): Promise<ListingVersionRow> {
  const rows = await query<ListingVersionDbRow>(
    `INSERT INTO listing_versions (
       listing_id, raw_listing_id, version_no, version_reason,
       content_fingerprint, listing_status,
       list_price_eur_cents, living_area_sqm, price_per_sqm_eur,
       normalized_snapshot, observed_at
     ) VALUES (
       $1, $2,
       COALESCE(
         (SELECT MAX(version_no) + 1 FROM listing_versions WHERE listing_id = $1),
         1
       ),
       $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW())
     )
     RETURNING *`,
    [
      input.listingId,
      input.rawListingId,
      input.versionReason,
      input.contentFingerprint,
      input.listingStatus,
      input.listPriceEurCents ?? null,
      input.livingAreaSqm ?? null,
      input.pricePerSqmEur ?? null,
      JSON.stringify(input.normalizedSnapshot),
      input.observedAt ?? null,
    ],
  );
  return toListingVersionRow(rows[0]!);
}

/**
 * Find version history for a listing, most recent first.
 */
export async function findByListingId(
  listingId: number,
  limit = 50,
): Promise<ListingVersionRow[]> {
  const rows = await query<ListingVersionDbRow>(
    `SELECT * FROM listing_versions
     WHERE listing_id = $1
     ORDER BY observed_at DESC
     LIMIT $2`,
    [listingId, limit],
  );
  return rows.map(toListingVersionRow);
}
