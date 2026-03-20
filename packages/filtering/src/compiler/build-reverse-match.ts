/**
 * Builds SQL to find active user_filters matching a given listing.
 * This is the reverse of listing search: "which filters match this listing?"
 */
export function buildReverseMatchQuery(listing: {
  operationType: string;
  propertyType: string;
  districtNo: number | null;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  currentScore: number | null;
}): { sql: string; params: unknown[] } {
  const params = [
    listing.operationType,      // $1
    listing.propertyType,       // $2
    listing.districtNo,         // $3
    listing.listPriceEurCents,  // $4
    listing.livingAreaSqm,      // $5
    listing.rooms,              // $6
    listing.currentScore,       // $7
  ];

  const sql = `
SELECT uf.id AS "filterId", uf.user_id AS "userId"
FROM user_filters uf
WHERE uf.is_active = TRUE
  AND (uf.operation_type IS NULL OR uf.operation_type = $1)
  AND (COALESCE(array_length(uf.property_types, 1), 0) = 0 OR $2 = ANY(uf.property_types))
  AND (COALESCE(array_length(uf.districts, 1), 0) = 0 OR $3::smallint = ANY(uf.districts))
  AND (uf.min_price_eur_cents IS NULL OR uf.min_price_eur_cents <= $4)
  AND (uf.max_price_eur_cents IS NULL OR uf.max_price_eur_cents >= $4)
  AND (uf.min_area_sqm IS NULL OR uf.min_area_sqm <= $5)
  AND (uf.max_area_sqm IS NULL OR uf.max_area_sqm >= $5)
  AND (uf.min_rooms IS NULL OR uf.min_rooms <= $6)
  AND (uf.max_rooms IS NULL OR uf.max_rooms >= $6)
  AND (uf.min_score IS NULL OR uf.min_score <= $7)`;

  return { sql, params };
}
