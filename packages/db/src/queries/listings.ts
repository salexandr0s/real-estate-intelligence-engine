import { query } from '../client.js';
import type {
  ListingRow,
  OperationType,
  PropertyType,
  ListingStatus,
  GeocodePrecision,
  SortBy,
} from '@rei/contracts';
import type { CanonicalListingInput } from '@rei/contracts';
import type { ListingSearchResult, PaginatedResult } from '@rei/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface ListingDbRow {
  id: string;
  listing_uid: string;
  source_id: string;
  source_listing_key: string;
  source_external_id: string | null;
  current_raw_listing_id: string;
  latest_scrape_run_id: string;
  canonical_url: string;
  operation_type: OperationType;
  property_type: PropertyType;
  property_subtype: string | null;
  listing_status: ListingStatus;
  source_status_raw: string | null;
  title: string;
  description: string | null;
  district_no: number | null;
  district_name: string | null;
  postal_code: string | null;
  city: string;
  federal_state: string | null;
  street: string | null;
  house_number: string | null;
  address_display: string | null;
  latitude: string | null;
  longitude: string | null;
  geocode_precision: GeocodePrecision | null;
  cross_source_fingerprint: string | null;
  list_price_eur_cents: string | null;
  monthly_operating_cost_eur_cents: string | null;
  reserve_fund_eur_cents: string | null;
  commission_eur_cents: string | null;
  living_area_sqm: string | null;
  usable_area_sqm: string | null;
  balcony_area_sqm: string | null;
  terrace_area_sqm: string | null;
  garden_area_sqm: string | null;
  rooms: string | null;
  floor_label: string | null;
  floor_number: number | null;
  year_built: number | null;
  condition_category: string | null;
  heating_type: string | null;
  energy_certificate_class: string | null;
  has_balcony: boolean | null;
  has_terrace: boolean | null;
  has_garden: boolean | null;
  has_elevator: boolean | null;
  parking_available: boolean | null;
  is_furnished: boolean | null;
  price_per_sqm_eur: string | null;
  completeness_score: string;
  current_score: string | null;
  normalization_version: number;
  content_fingerprint: string;
  normalized_payload: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
  first_published_at: Date | null;
  last_price_change_at: Date | null;
  last_content_change_at: Date | null;
  last_status_change_at: Date | null;
  last_scored_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toListingRow(row: ListingDbRow): ListingRow {
  return {
    id: Number(row.id),
    listingUid: row.listing_uid,
    sourceId: Number(row.source_id),
    sourceListingKey: row.source_listing_key,
    sourceExternalId: row.source_external_id,
    currentRawListingId: Number(row.current_raw_listing_id),
    latestScrapeRunId: Number(row.latest_scrape_run_id),
    canonicalUrl: row.canonical_url,
    operationType: row.operation_type,
    propertyType: row.property_type,
    propertySubtype: row.property_subtype,
    listingStatus: row.listing_status,
    sourceStatusRaw: row.source_status_raw,
    title: row.title,
    description: row.description,
    districtNo: row.district_no,
    districtName: row.district_name,
    postalCode: row.postal_code,
    city: row.city,
    federalState: row.federal_state,
    street: row.street,
    houseNumber: row.house_number,
    addressDisplay: row.address_display,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    geocodePrecision: row.geocode_precision,
    crossSourceFingerprint: row.cross_source_fingerprint,
    listPriceEurCents: row.list_price_eur_cents != null ? Number(row.list_price_eur_cents) : null,
    monthlyOperatingCostEurCents:
      row.monthly_operating_cost_eur_cents != null
        ? Number(row.monthly_operating_cost_eur_cents)
        : null,
    reserveFundEurCents:
      row.reserve_fund_eur_cents != null ? Number(row.reserve_fund_eur_cents) : null,
    commissionEurCents: row.commission_eur_cents != null ? Number(row.commission_eur_cents) : null,
    livingAreaSqm: row.living_area_sqm != null ? Number(row.living_area_sqm) : null,
    usableAreaSqm: row.usable_area_sqm != null ? Number(row.usable_area_sqm) : null,
    balconyAreaSqm: row.balcony_area_sqm != null ? Number(row.balcony_area_sqm) : null,
    terraceAreaSqm: row.terrace_area_sqm != null ? Number(row.terrace_area_sqm) : null,
    gardenAreaSqm: row.garden_area_sqm != null ? Number(row.garden_area_sqm) : null,
    rooms: row.rooms != null ? Number(row.rooms) : null,
    floorLabel: row.floor_label,
    floorNumber: row.floor_number,
    yearBuilt: row.year_built,
    conditionCategory: row.condition_category,
    heatingType: row.heating_type,
    energyCertificateClass: row.energy_certificate_class,
    hasBalcony: row.has_balcony,
    hasTerrace: row.has_terrace,
    hasGarden: row.has_garden,
    hasElevator: row.has_elevator,
    parkingAvailable: row.parking_available,
    isFurnished: row.is_furnished,
    pricePerSqmEur: row.price_per_sqm_eur != null ? Number(row.price_per_sqm_eur) : null,
    completenessScore: Number(row.completeness_score),
    currentScore: row.current_score != null ? Number(row.current_score) : null,
    normalizationVersion: row.normalization_version,
    contentFingerprint: row.content_fingerprint,
    normalizedPayload: row.normalized_payload,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    firstPublishedAt: row.first_published_at,
    lastPriceChangeAt: row.last_price_change_at,
    lastContentChangeAt: row.last_content_change_at,
    lastStatusChangeAt: row.last_status_change_at,
    lastScoredAt: row.last_scored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Search result mapping ───────────────────────────────────────────────────

interface ListingSearchDbRow {
  id: string;
  listing_uid: string;
  source_code: string | null;
  canonical_url: string;
  title: string;
  operation_type: string;
  property_type: string;
  city: string;
  postal_code: string | null;
  district_no: number | null;
  district_name: string | null;
  list_price_eur_cents: string | null;
  living_area_sqm: string | null;
  rooms: string | null;
  price_per_sqm_eur: string | null;
  current_score: string | null;
  first_seen_at: Date;
  listing_status: string;
  latitude: string | null;
  longitude: string | null;
  geocode_precision: string | null;
}

function toListingSearchResult(row: ListingSearchDbRow): ListingSearchResult {
  return {
    id: Number(row.id),
    listingUid: row.listing_uid,
    sourceCode: row.source_code ?? undefined,
    canonicalUrl: row.canonical_url,
    title: row.title,
    operationType: row.operation_type,
    propertyType: row.property_type,
    city: row.city,
    postalCode: row.postal_code,
    districtNo: row.district_no,
    districtName: row.district_name,
    listPriceEurCents: row.list_price_eur_cents != null ? Number(row.list_price_eur_cents) : null,
    livingAreaSqm: row.living_area_sqm != null ? Number(row.living_area_sqm) : null,
    rooms: row.rooms != null ? Number(row.rooms) : null,
    pricePerSqmEur: row.price_per_sqm_eur != null ? Number(row.price_per_sqm_eur) : null,
    currentScore: row.current_score != null ? Number(row.current_score) : null,
    firstSeenAt: row.first_seen_at,
    listingStatus: row.listing_status,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    geocodePrecision: row.geocode_precision,
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Idempotent upsert on (source_id, source_listing_key).
 *
 * On insert: sets first_seen_at and last_seen_at.
 * On update: updates last_seen_at, detects price/status/content changes
 * and sets the corresponding timestamps.
 */
export async function upsertListing(input: CanonicalListingInput): Promise<ListingRow> {
  const rows = await query<ListingDbRow>(
    `INSERT INTO listings (
       source_id, source_listing_key, source_external_id,
       current_raw_listing_id, latest_scrape_run_id, canonical_url,
       operation_type, property_type, property_subtype, listing_status, source_status_raw,
       title, description,
       district_no, district_name, postal_code, city, federal_state,
       street, house_number, address_display,
       latitude, longitude, geocode_precision,
       list_price_eur_cents, monthly_operating_cost_eur_cents,
       reserve_fund_eur_cents, commission_eur_cents,
       living_area_sqm, usable_area_sqm,
       balcony_area_sqm, terrace_area_sqm, garden_area_sqm,
       rooms, floor_label, floor_number, year_built,
       condition_category, heating_type, energy_certificate_class,
       has_balcony, has_terrace, has_garden, has_elevator,
       parking_available, is_furnished,
       normalized_payload, completeness_score, content_fingerprint,
       normalization_version,
       first_seen_at, last_seen_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
       $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
       $32, $33, $34, $35, $36, $37, $38, $39, $40, $41,
       $42, $43, $44, $45, $46, $47, $48, $49, $50,
       NOW(), NOW()
     )
     ON CONFLICT (source_id, source_listing_key) DO UPDATE SET
       current_raw_listing_id = EXCLUDED.current_raw_listing_id,
       latest_scrape_run_id = EXCLUDED.latest_scrape_run_id,
       canonical_url = EXCLUDED.canonical_url,
       operation_type = EXCLUDED.operation_type,
       property_type = EXCLUDED.property_type,
       property_subtype = EXCLUDED.property_subtype,
       listing_status = EXCLUDED.listing_status,
       source_status_raw = EXCLUDED.source_status_raw,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       district_no = EXCLUDED.district_no,
       district_name = EXCLUDED.district_name,
       postal_code = EXCLUDED.postal_code,
       city = EXCLUDED.city,
       federal_state = EXCLUDED.federal_state,
       street = EXCLUDED.street,
       house_number = EXCLUDED.house_number,
       address_display = EXCLUDED.address_display,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       geocode_precision = EXCLUDED.geocode_precision,
       list_price_eur_cents = EXCLUDED.list_price_eur_cents,
       monthly_operating_cost_eur_cents = EXCLUDED.monthly_operating_cost_eur_cents,
       reserve_fund_eur_cents = EXCLUDED.reserve_fund_eur_cents,
       commission_eur_cents = EXCLUDED.commission_eur_cents,
       living_area_sqm = EXCLUDED.living_area_sqm,
       usable_area_sqm = EXCLUDED.usable_area_sqm,
       balcony_area_sqm = EXCLUDED.balcony_area_sqm,
       terrace_area_sqm = EXCLUDED.terrace_area_sqm,
       garden_area_sqm = EXCLUDED.garden_area_sqm,
       rooms = EXCLUDED.rooms,
       floor_label = EXCLUDED.floor_label,
       floor_number = EXCLUDED.floor_number,
       year_built = EXCLUDED.year_built,
       condition_category = EXCLUDED.condition_category,
       heating_type = EXCLUDED.heating_type,
       energy_certificate_class = EXCLUDED.energy_certificate_class,
       has_balcony = EXCLUDED.has_balcony,
       has_terrace = EXCLUDED.has_terrace,
       has_garden = EXCLUDED.has_garden,
       has_elevator = EXCLUDED.has_elevator,
       parking_available = EXCLUDED.parking_available,
       is_furnished = EXCLUDED.is_furnished,
       normalized_payload = EXCLUDED.normalized_payload,
       completeness_score = EXCLUDED.completeness_score,
       content_fingerprint = EXCLUDED.content_fingerprint,
       normalization_version = EXCLUDED.normalization_version,
       last_seen_at = NOW(),
       last_price_change_at = CASE
         WHEN listings.list_price_eur_cents IS DISTINCT FROM EXCLUDED.list_price_eur_cents
         THEN NOW()
         ELSE listings.last_price_change_at
       END,
       last_status_change_at = CASE
         WHEN listings.listing_status IS DISTINCT FROM EXCLUDED.listing_status
         THEN NOW()
         ELSE listings.last_status_change_at
       END,
       last_content_change_at = CASE
         WHEN listings.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
         THEN NOW()
         ELSE listings.last_content_change_at
       END
     RETURNING *`,
    [
      input.sourceId,
      input.sourceListingKey,
      input.sourceExternalId ?? null,
      input.currentRawListingId,
      input.latestScrapeRunId,
      input.canonicalUrl,
      input.operationType,
      input.propertyType,
      input.propertySubtype ?? null,
      input.listingStatus,
      input.sourceStatusRaw ?? null,
      input.title,
      input.description ?? null,
      input.districtNo ?? null,
      input.districtName ?? null,
      input.postalCode ?? null,
      input.city,
      input.federalState ?? null,
      input.street ?? null,
      input.houseNumber ?? null,
      input.addressDisplay ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.geocodePrecision ?? null,
      input.listPriceEurCents ?? null,
      input.monthlyOperatingCostEurCents ?? null,
      input.reserveFundEurCents ?? null,
      input.commissionEurCents ?? null,
      input.livingAreaSqm ?? null,
      input.usableAreaSqm ?? null,
      input.balconyAreaSqm ?? null,
      input.terraceAreaSqm ?? null,
      input.gardenAreaSqm ?? null,
      input.rooms ?? null,
      input.floorLabel ?? null,
      input.floorNumber ?? null,
      input.yearBuilt ?? null,
      input.conditionCategory ?? null,
      input.heatingType ?? null,
      input.energyCertificateClass ?? null,
      input.hasBalcony ?? null,
      input.hasTerrace ?? null,
      input.hasGarden ?? null,
      input.hasElevator ?? null,
      input.parkingAvailable ?? null,
      input.isFurnished ?? null,
      JSON.stringify(input.normalizedPayload),
      input.completenessScore,
      input.contentFingerprint,
      input.normalizationVersion,
    ],
  );
  return toListingRow(rows[0]!);
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export async function findById(id: number): Promise<ListingRow | null> {
  const rows = await query<ListingDbRow>('SELECT * FROM listings WHERE id = $1', [id]);
  const row = rows[0];
  return row ? toListingRow(row) : null;
}

export async function findByUid(uid: string): Promise<ListingRow | null> {
  const rows = await query<ListingDbRow>('SELECT * FROM listings WHERE listing_uid = $1', [uid]);
  const row = rows[0];
  return row ? toListingRow(row) : null;
}

export async function findBySourceKey(
  sourceId: number,
  sourceListingKey: string,
): Promise<ListingRow | null> {
  const rows = await query<ListingDbRow>(
    'SELECT * FROM listings WHERE source_id = $1 AND source_listing_key = $2',
    [sourceId, sourceListingKey],
  );
  const row = rows[0];
  return row ? toListingRow(row) : null;
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface ListingSearchFilter {
  operationType?: OperationType | null;
  propertyTypes?: PropertyType[];
  districts?: number[];
  minPriceEurCents?: number | null;
  maxPriceEurCents?: number | null;
  minAreaSqm?: number | null;
  maxAreaSqm?: number | null;
  minRooms?: number | null;
  maxRooms?: number | null;
  minScore?: number | null;
  sortBy?: SortBy;
}

/**
 * Search active listings with parameterized, SARGable filters.
 *
 * Uses cursor-based pagination with encoded cursor of (sort_value, id).
 * Each filter parameter is passed as a nullable typed parameter so
 * Postgres can skip the predicate when the value is NULL.
 */
export async function searchListings(
  filter: ListingSearchFilter,
  cursor: string | null,
  limit = 25,
): Promise<PaginatedResult<ListingSearchResult>> {
  const sortBy = filter.sortBy ?? 'score_desc';
  const { orderClause, cursorClause, cursorParams } = buildSortAndCursor(sortBy, cursor);

  // Parameter offset: filter params are $1-$10, cursor params start at $11
  const filterParamOffset = 10;
  const cursorParamSql = cursorClause
    ? cursorClause.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + filterParamOffset}`)
    : '';

  const limitParamIndex = filterParamOffset + cursorParams.length + 1;

  const sql = `
    SELECT
      l.id, l.listing_uid, s.code AS source_code,
      l.canonical_url, l.title, l.operation_type, l.property_type,
      l.city, l.postal_code, l.district_no, l.district_name,
      l.list_price_eur_cents, l.living_area_sqm, l.rooms,
      l.price_per_sqm_eur, l.current_score,
      l.first_seen_at, l.listing_status,
      l.latitude, l.longitude, l.geocode_precision
    FROM listings l
    JOIN sources s ON s.id = l.source_id
    WHERE l.listing_status = 'active'
      AND l.district_no IS NOT NULL
      AND ($1::text IS NULL OR l.operation_type = $1)
      AND (COALESCE(array_length($2::text[], 1), 0) = 0 OR l.property_type = ANY($2))
      AND (COALESCE(array_length($3::smallint[], 1), 0) = 0 OR l.district_no = ANY($3))
      AND ($4::bigint IS NULL OR l.list_price_eur_cents >= $4)
      AND ($5::bigint IS NULL OR l.list_price_eur_cents <= $5)
      AND ($6::numeric IS NULL OR l.living_area_sqm >= $6)
      AND ($7::numeric IS NULL OR l.living_area_sqm <= $7)
      AND ($8::numeric IS NULL OR l.rooms >= $8)
      AND ($9::numeric IS NULL OR l.rooms <= $9)
      AND ($10::numeric IS NULL OR l.current_score >= $10)
      ${cursorParamSql ? `AND (${cursorParamSql})` : ''}
    ORDER BY ${orderClause}
    LIMIT $${limitParamIndex}
  `;

  const params: unknown[] = [
    filter.operationType ?? null,
    filter.propertyTypes && filter.propertyTypes.length > 0 ? filter.propertyTypes : null,
    filter.districts && filter.districts.length > 0 ? filter.districts : null,
    filter.minPriceEurCents ?? null,
    filter.maxPriceEurCents ?? null,
    filter.minAreaSqm ?? null,
    filter.maxAreaSqm ?? null,
    filter.minRooms ?? null,
    filter.maxRooms ?? null,
    filter.minScore ?? null,
    ...cursorParams,
    limit + 1, // Fetch one extra to detect hasMore
  ];

  const rows = await query<ListingSearchDbRow>(sql, params);

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const data = resultRows.map(toListingSearchResult);

  let nextCursor: string | null = null;
  if (hasMore && resultRows.length > 0) {
    const lastRow = resultRows[resultRows.length - 1]!;
    nextCursor = encodeCursor(sortBy, lastRow);
  }

  return {
    data,
    meta: {
      nextCursor,
      pageSize: limit,
    },
  };
}

// ── Score update ────────────────────────────────────────────────────────────

export async function updateScore(
  id: number,
  score: number,
  scoredAt: Date,
): Promise<ListingRow | null> {
  const rows = await query<ListingDbRow>(
    `UPDATE listings
     SET current_score = $2, last_scored_at = $3
     WHERE id = $1
     RETURNING *`,
    [id, score, scoredAt],
  );
  const row = rows[0];
  return row ? toListingRow(row) : null;
}

// ── Geocoding ───────────────────────────────────────────────────────────────

export async function updateCoordinates(
  id: number,
  latitude: number,
  longitude: number,
  geocodePrecision: GeocodePrecision,
): Promise<void> {
  await query(
    `UPDATE listings
     SET latitude = $2, longitude = $3, geocode_precision = $4
     WHERE id = $1`,
    [id, latitude, longitude, geocodePrecision],
  );
}

export async function findListingsNeedingGeocoding(limit = 100): Promise<ListingRow[]> {
  const rows = await query<ListingDbRow>(
    `SELECT * FROM listings
     WHERE latitude IS NULL
     AND listing_status = 'active'
     ORDER BY first_seen_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(toListingRow);
}

// ── Cursor helpers ──────────────────────────────────────────────────────────

interface CursorData {
  sortValue: string;
  id: string;
}

function encodeCursor(sortBy: SortBy, row: ListingSearchDbRow): string {
  let sortValue: string;
  switch (sortBy) {
    case 'score_desc':
      sortValue = row.current_score ?? '0';
      break;
    case 'newest':
      sortValue = row.first_seen_at.toISOString();
      break;
    case 'price_asc':
    case 'price_desc':
      sortValue = row.list_price_eur_cents ?? '0';
      break;
    case 'sqm_desc':
      sortValue = row.living_area_sqm ?? '0';
      break;
  }
  const data: CursorData = { sortValue, id: row.id };
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sortValue' in parsed) ||
      !('id' in parsed)
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    return { sortValue: String(obj.sortValue), id: String(obj.id) };
  } catch {
    return null;
  }
}

interface SortCursorResult {
  orderClause: string;
  cursorClause: string | null;
  cursorParams: unknown[];
}

function buildSortAndCursor(sortBy: SortBy, cursor: string | null): SortCursorResult {
  const parsed = cursor ? decodeCursor(cursor) : null;

  switch (sortBy) {
    case 'score_desc':
      return {
        orderClause: 'l.current_score DESC NULLS LAST, l.id DESC',
        cursorClause: parsed
          ? '(l.current_score < $1::numeric OR (l.current_score = $1::numeric AND l.id < $2::bigint))'
          : null,
        cursorParams: parsed ? [parsed.sortValue, parsed.id] : [],
      };
    case 'newest':
      return {
        orderClause: 'l.first_seen_at DESC, l.id DESC',
        cursorClause: parsed
          ? '(l.first_seen_at < $1::timestamptz OR (l.first_seen_at = $1::timestamptz AND l.id < $2::bigint))'
          : null,
        cursorParams: parsed ? [parsed.sortValue, parsed.id] : [],
      };
    case 'price_asc':
      return {
        orderClause: 'l.list_price_eur_cents ASC NULLS LAST, l.id DESC',
        cursorClause: parsed
          ? '(l.list_price_eur_cents > $1::bigint OR (l.list_price_eur_cents = $1::bigint AND l.id < $2::bigint))'
          : null,
        cursorParams: parsed ? [parsed.sortValue, parsed.id] : [],
      };
    case 'price_desc':
      return {
        orderClause: 'l.list_price_eur_cents DESC NULLS LAST, l.id DESC',
        cursorClause: parsed
          ? '(l.list_price_eur_cents < $1::bigint OR (l.list_price_eur_cents = $1::bigint AND l.id < $2::bigint))'
          : null,
        cursorParams: parsed ? [parsed.sortValue, parsed.id] : [],
      };
    case 'sqm_desc':
      return {
        orderClause: 'l.living_area_sqm DESC NULLS LAST, l.id DESC',
        cursorClause: parsed
          ? '(l.living_area_sqm < $1::numeric OR (l.living_area_sqm = $1::numeric AND l.id < $2::bigint))'
          : null,
        cursorParams: parsed ? [parsed.sortValue, parsed.id] : [],
      };
  }
}
