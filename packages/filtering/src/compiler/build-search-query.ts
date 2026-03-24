import type { CompiledFilter } from '@immoradar/contracts';

interface CursorData {
  sortValue: number | string;
  id: number;
}

export function decodeCursor(cursor: string | null | undefined): CursorData | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sortValue' in parsed) ||
      !('id' in parsed)
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    return {
      sortValue: typeof obj.sortValue === 'number' ? obj.sortValue : Number(obj.sortValue),
      id: typeof obj.id === 'number' ? obj.id : Number(obj.id),
    };
  } catch {
    return null;
  }
}

export function encodeCursor(sortValue: number | string, id: number): string {
  return Buffer.from(JSON.stringify({ sortValue, id })).toString('base64');
}

/**
 * Builds parameterized SQL for listing search with cursor pagination.
 * All predicates are SARGable and match the indexed columns from schema.sql.
 */
export function buildListingSearchQuery(
  filter: CompiledFilter,
  cursor: string | null | undefined,
  limit: number,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [
    filter.operationType ?? null, // $1
    filter.propertyTypes ?? [], // $2
    filter.districts ?? [], // $3
    filter.minPriceCents ?? null, // $4
    filter.maxPriceCents ?? null, // $5
    filter.minAreaSqm ?? null, // $6
    filter.maxAreaSqm ?? null, // $7
    filter.minRooms ?? null, // $8
    filter.maxRooms ?? null, // $9
    filter.minScore ?? null, // $10
    filter.requiredKeywords ?? [], // $11
    filter.excludedKeywords ?? [], // $12
  ];

  let cursorClause = '';
  const decoded = decodeCursor(cursor);

  const sortConfig = getSortConfig(filter.sortBy);

  if (decoded) {
    const cursorParamIdx = params.length + 1;
    params.push(decoded.sortValue); // cursor sort value
    params.push(decoded.id); // cursor id
    cursorClause = `AND (${sortConfig.column}, l.id) ${sortConfig.direction === 'DESC' ? '<' : '>'} ($${cursorParamIdx}::${sortConfig.castType}, $${cursorParamIdx + 1}::bigint)`;
  }

  const limitParamIdx = params.length + 1;
  params.push(limit);

  const sql = `
SELECT
  l.id,
  l.listing_uid AS "listingUid",
  l.canonical_url AS "canonicalUrl",
  l.title,
  l.operation_type AS "operationType",
  l.property_type AS "propertyType",
  l.city,
  l.postal_code AS "postalCode",
  l.district_no AS "districtNo",
  l.district_name AS "districtName",
  l.list_price_eur_cents AS "listPriceEurCents",
  l.living_area_sqm AS "livingAreaSqm",
  l.rooms,
  l.price_per_sqm_eur AS "pricePerSqmEur",
  l.current_score AS "currentScore",
  l.first_seen_at AS "firstSeenAt",
  l.listing_status AS "listingStatus"
FROM listings l
WHERE l.listing_status = 'active'
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
  AND (COALESCE(array_length($11::text[], 1), 0) = 0
       OR (SELECT bool_and(
             l.title ILIKE '%' || replace(replace(kw, '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'
             OR COALESCE(l.description, '') ILIKE '%' || replace(replace(kw, '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\')
           FROM unnest($11::text[]) AS kw))
  AND (COALESCE(array_length($12::text[], 1), 0) = 0
       OR NOT EXISTS (SELECT 1 FROM unnest($12::text[]) AS kw
                      WHERE l.title ILIKE '%' || replace(replace(kw, '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'
                         OR COALESCE(l.description, '') ILIKE '%' || replace(replace(kw, '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'))
  ${cursorClause}
ORDER BY ${sortConfig.column} ${sortConfig.direction}, l.id ${sortConfig.direction}
LIMIT $${limitParamIdx}`;

  return { sql, params };
}

function getSortConfig(sortBy: string): {
  column: string;
  direction: 'ASC' | 'DESC';
  castType: string;
} {
  switch (sortBy) {
    case 'newest':
      return { column: 'l.first_seen_at', direction: 'DESC', castType: 'timestamptz' };
    case 'price_asc':
      return { column: 'l.list_price_eur_cents', direction: 'ASC', castType: 'bigint' };
    case 'price_desc':
      return { column: 'l.list_price_eur_cents', direction: 'DESC', castType: 'bigint' };
    case 'sqm_desc':
      return { column: 'l.living_area_sqm', direction: 'DESC', castType: 'numeric' };
    case 'score_desc':
    default:
      return { column: 'l.current_score', direction: 'DESC', castType: 'numeric' };
  }
}
