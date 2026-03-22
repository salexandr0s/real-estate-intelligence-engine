import { query } from '../client.js';
import { csvSafe } from '../util/csv.js';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface SavedListingDbRow {
  id: string;
  user_id: string;
  listing_id: string;
  notes: string | null;
  saved_at: Date;
  created_at: Date;
}

export interface SavedListingRow {
  id: number;
  userId: number;
  listingId: number;
  notes: string | null;
  savedAt: Date;
  createdAt: Date;
}

function toSavedListingRow(row: SavedListingDbRow): SavedListingRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    listingId: Number(row.listing_id),
    notes: row.notes,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function save(
  userId: number,
  listingId: number,
  notes?: string,
): Promise<SavedListingRow> {
  const rows = await query<SavedListingDbRow>(
    `INSERT INTO user_saved_listings (user_id, listing_id, notes)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, listing_id) DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW()
     RETURNING id, user_id, listing_id, notes, saved_at, created_at`,
    [userId, listingId, notes ?? null],
  );
  return toSavedListingRow(rows[0]!);
}

export async function unsave(userId: number, listingId: number): Promise<boolean> {
  const rows = await query(
    `DELETE FROM user_saved_listings WHERE user_id = $1 AND listing_id = $2 RETURNING id`,
    [userId, listingId],
  );
  return rows.length > 0;
}

export async function isSaved(userId: number, listingId: number): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM user_saved_listings WHERE user_id = $1 AND listing_id = $2) AS exists`,
    [userId, listingId],
  );
  return rows[0]?.exists ?? false;
}

export async function findSavedIds(userId: number, listingIds: number[]): Promise<Set<number>> {
  if (listingIds.length === 0) return new Set();
  const rows = await query<{ listing_id: string }>(
    `SELECT listing_id FROM user_saved_listings
     WHERE user_id = $1 AND listing_id = ANY($2::bigint[])`,
    [userId, listingIds],
  );
  return new Set(rows.map((r) => Number(r.listing_id)));
}

export async function countByUser(userId: number): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM user_saved_listings WHERE user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Saved listing with joined listing data for the list view. */
export interface SavedListingWithListing extends SavedListingRow {
  listing: {
    id: number;
    listingUid: string;
    sourceCode: string;
    title: string;
    canonicalUrl: string;
    operationType: string;
    propertyType: string;
    city: string;
    districtNo: number | null;
    districtName: string | null;
    listPriceEurCents: number | null;
    livingAreaSqm: number | null;
    rooms: number | null;
    pricePerSqmEur: number | null;
    currentScore: number | null;
    firstSeenAt: Date;
    listingStatus: string;
  };
}

interface SavedListingJoinedDbRow extends SavedListingDbRow {
  l_id: string;
  listing_uid: string;
  source_code: string;
  title: string;
  canonical_url: string;
  operation_type: string;
  property_type: string;
  city: string;
  district_no: number | null;
  district_name: string | null;
  list_price_eur_cents: string | null;
  living_area_sqm: string | null;
  rooms: string | null;
  price_per_sqm_eur: string | null;
  current_score: string | null;
  first_seen_at: Date;
  listing_status: string;
}

export async function findByUser(
  userId: number,
  limit = 50,
  cursor?: string,
): Promise<{ data: SavedListingWithListing[]; nextCursor: string | null }> {
  const cursorDate = cursor ? new Date(cursor) : null;

  const rows = await query<SavedListingJoinedDbRow>(
    `SELECT
       usl.id, usl.user_id, usl.listing_id, usl.notes, usl.saved_at, usl.created_at,
       l.id AS l_id, l.listing_uid, s.code AS source_code,
       l.title, l.canonical_url, l.operation_type, l.property_type,
       l.city, l.district_no, l.district_name,
       l.list_price_eur_cents, l.living_area_sqm, l.rooms,
       l.price_per_sqm_eur, l.current_score, l.first_seen_at, l.listing_status
     FROM user_saved_listings usl
     JOIN listings l ON l.id = usl.listing_id
     JOIN sources s ON s.id = l.source_id
     WHERE usl.user_id = $1
       AND ($3::timestamptz IS NULL OR usl.saved_at < $3)
     ORDER BY usl.saved_at DESC
     LIMIT $2`,
    [userId, limit + 1, cursorDate],
  );

  const hasNext = rows.length > limit;
  const data = (hasNext ? rows.slice(0, limit) : rows).map((r) => ({
    ...toSavedListingRow(r),
    listing: {
      id: Number(r.l_id),
      listingUid: r.listing_uid,
      sourceCode: r.source_code,
      title: r.title,
      canonicalUrl: r.canonical_url,
      operationType: r.operation_type,
      propertyType: r.property_type,
      city: r.city,
      districtNo: r.district_no,
      districtName: r.district_name,
      listPriceEurCents: r.list_price_eur_cents != null ? Number(r.list_price_eur_cents) : null,
      livingAreaSqm: r.living_area_sqm != null ? Number(r.living_area_sqm) : null,
      rooms: r.rooms != null ? Number(r.rooms) : null,
      pricePerSqmEur: r.price_per_sqm_eur != null ? Number(r.price_per_sqm_eur) : null,
      currentScore: r.current_score != null ? Number(r.current_score) : null,
      firstSeenAt: r.first_seen_at,
      listingStatus: r.listing_status,
    },
  }));

  const nextCursor =
    hasNext && data.length > 0 ? data[data.length - 1]!.savedAt.toISOString() : null;

  return { data, nextCursor };
}

/** Generate CSV export of saved listings. */
export async function exportCsv(userId: number): Promise<string> {
  const { data } = await findByUser(userId, 10000);
  const header = 'id,title,source,district,price_eur,area_sqm,rooms,score,url,notes,saved_at';
  const rows = data.map((s) => {
    const l = s.listing;
    const price = l.listPriceEurCents != null ? (l.listPriceEurCents / 100).toFixed(0) : '';
    const area = l.livingAreaSqm?.toFixed(1) ?? '';
    const rooms = l.rooms?.toFixed(1) ?? '';
    const score = l.currentScore?.toFixed(1) ?? '';
    const title = csvSafe(l.title);
    const notes = csvSafe(s.notes ?? '');
    return `${l.id},"${title}",${l.sourceCode},${l.districtNo ?? ''},${price},${area},${rooms},${score},"${l.canonicalUrl}","${notes}",${s.savedAt.toISOString()}`;
  });
  return [header, ...rows].join('\n');
}
