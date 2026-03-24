import { query } from '../client.js';
import type {
  UserFilterRow,
  FilterCreateInput,
  FilterUpdateInput,
  FilterKind,
  AlertFrequency,
  SortBy,
  OperationType,
} from '@immoradar/contracts';
import { passesKeywordFilter } from '@immoradar/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface UserFilterDbRow {
  id: string;
  user_id: string;
  name: string;
  filter_kind: FilterKind;
  is_active: boolean;
  operation_type: OperationType | null;
  property_types: string[];
  districts: number[];
  postal_codes: string[];
  min_price_eur_cents: string | null;
  max_price_eur_cents: string | null;
  min_area_sqm: string | null;
  max_area_sqm: string | null;
  min_rooms: string | null;
  max_rooms: string | null;
  required_keywords: string[];
  excluded_keywords: string[];
  min_score: string | null;
  sort_by: SortBy;
  alert_frequency: AlertFrequency;
  alert_channels: string[];
  criteria_json: Record<string, unknown>;
  last_evaluated_at: Date | null;
  last_match_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toUserFilterRow(row: UserFilterDbRow): UserFilterRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: row.name,
    filterKind: row.filter_kind,
    isActive: row.is_active,
    operationType: row.operation_type,
    propertyTypes: row.property_types,
    districts: row.districts,
    postalCodes: row.postal_codes,
    minPriceEurCents: row.min_price_eur_cents != null ? Number(row.min_price_eur_cents) : null,
    maxPriceEurCents: row.max_price_eur_cents != null ? Number(row.max_price_eur_cents) : null,
    minAreaSqm: row.min_area_sqm != null ? Number(row.min_area_sqm) : null,
    maxAreaSqm: row.max_area_sqm != null ? Number(row.max_area_sqm) : null,
    minRooms: row.min_rooms != null ? Number(row.min_rooms) : null,
    maxRooms: row.max_rooms != null ? Number(row.max_rooms) : null,
    requiredKeywords: row.required_keywords,
    excludedKeywords: row.excluded_keywords,
    minScore: row.min_score != null ? Number(row.min_score) : null,
    sortBy: row.sort_by,
    alertFrequency: row.alert_frequency,
    alertChannels: row.alert_channels,
    criteriaJson: row.criteria_json,
    lastEvaluatedAt: row.last_evaluated_at,
    lastMatchAt: row.last_match_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function create(input: FilterCreateInput): Promise<UserFilterRow> {
  const criteria = input.criteria;
  const minPriceCents =
    criteria.minPriceEur != null ? Math.round(criteria.minPriceEur * 100) : null;
  const maxPriceCents =
    criteria.maxPriceEur != null ? Math.round(criteria.maxPriceEur * 100) : null;

  const rows = await query<UserFilterDbRow>(
    `INSERT INTO user_filters (
       user_id, name, filter_kind,
       operation_type, property_types, districts, postal_codes,
       min_price_eur_cents, max_price_eur_cents,
       min_area_sqm, max_area_sqm,
       min_rooms, max_rooms,
       required_keywords, excluded_keywords, min_score,
       sort_by, alert_frequency, alert_channels, criteria_json
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $18, $19, $20
     )
     RETURNING *`,
    [
      input.userId,
      input.name,
      input.filterKind,
      criteria.operationType ?? null,
      criteria.propertyTypes ?? [],
      criteria.districts ?? [],
      criteria.postalCodes ?? [],
      minPriceCents,
      maxPriceCents,
      criteria.minAreaSqm ?? null,
      criteria.maxAreaSqm ?? null,
      criteria.minRooms ?? null,
      criteria.maxRooms ?? null,
      criteria.requiredKeywords ?? [],
      criteria.excludedKeywords ?? [],
      criteria.minScore ?? null,
      criteria.sortBy ?? 'score_desc',
      input.alertFrequency,
      input.alertChannels,
      JSON.stringify(criteria),
    ],
  );
  return toUserFilterRow(rows[0]!);
}

export async function update(id: number, input: FilterUpdateInput): Promise<UserFilterRow | null> {
  // Build SET clauses dynamically based on provided fields
  const setClauses: string[] = [];
  const params: unknown[] = [id];
  let paramIndex = 2;

  if (input.name !== undefined) {
    setClauses.push(`name = $${paramIndex}`);
    params.push(input.name);
    paramIndex++;
  }

  if (input.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex}`);
    params.push(input.isActive);
    paramIndex++;
  }

  if (input.alertFrequency !== undefined) {
    setClauses.push(`alert_frequency = $${paramIndex}`);
    params.push(input.alertFrequency);
    paramIndex++;
  }

  if (input.alertChannels !== undefined) {
    setClauses.push(`alert_channels = $${paramIndex}`);
    params.push(input.alertChannels);
    paramIndex++;
  }

  if (input.criteria !== undefined) {
    const c = input.criteria;

    if (c.operationType !== undefined) {
      setClauses.push(`operation_type = $${paramIndex}`);
      params.push(c.operationType ?? null);
      paramIndex++;
    }
    if (c.propertyTypes !== undefined) {
      setClauses.push(`property_types = $${paramIndex}`);
      params.push(c.propertyTypes);
      paramIndex++;
    }
    if (c.districts !== undefined) {
      setClauses.push(`districts = $${paramIndex}`);
      params.push(c.districts);
      paramIndex++;
    }
    if (c.postalCodes !== undefined) {
      setClauses.push(`postal_codes = $${paramIndex}`);
      params.push(c.postalCodes);
      paramIndex++;
    }
    if (c.minPriceEur !== undefined) {
      setClauses.push(`min_price_eur_cents = $${paramIndex}`);
      params.push(c.minPriceEur != null ? Math.round(c.minPriceEur * 100) : null);
      paramIndex++;
    }
    if (c.maxPriceEur !== undefined) {
      setClauses.push(`max_price_eur_cents = $${paramIndex}`);
      params.push(c.maxPriceEur != null ? Math.round(c.maxPriceEur * 100) : null);
      paramIndex++;
    }
    if (c.minAreaSqm !== undefined) {
      setClauses.push(`min_area_sqm = $${paramIndex}`);
      params.push(c.minAreaSqm ?? null);
      paramIndex++;
    }
    if (c.maxAreaSqm !== undefined) {
      setClauses.push(`max_area_sqm = $${paramIndex}`);
      params.push(c.maxAreaSqm ?? null);
      paramIndex++;
    }
    if (c.minRooms !== undefined) {
      setClauses.push(`min_rooms = $${paramIndex}`);
      params.push(c.minRooms ?? null);
      paramIndex++;
    }
    if (c.maxRooms !== undefined) {
      setClauses.push(`max_rooms = $${paramIndex}`);
      params.push(c.maxRooms ?? null);
      paramIndex++;
    }
    if (c.requiredKeywords !== undefined) {
      setClauses.push(`required_keywords = $${paramIndex}`);
      params.push(c.requiredKeywords);
      paramIndex++;
    }
    if (c.excludedKeywords !== undefined) {
      setClauses.push(`excluded_keywords = $${paramIndex}`);
      params.push(c.excludedKeywords);
      paramIndex++;
    }
    if (c.minScore !== undefined) {
      setClauses.push(`min_score = $${paramIndex}`);
      params.push(c.minScore ?? null);
      paramIndex++;
    }
    if (c.sortBy !== undefined) {
      setClauses.push(`sort_by = $${paramIndex}`);
      params.push(c.sortBy);
      paramIndex++;
    }

    // Always update criteria_json when criteria changes
    setClauses.push(`criteria_json = $${paramIndex}`);
    params.push(JSON.stringify(c));
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return findById(id);
  }

  const rows = await query<UserFilterDbRow>(
    `UPDATE user_filters SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  const row = rows[0];
  return row ? toUserFilterRow(row) : null;
}

export async function findById(id: number): Promise<UserFilterRow | null> {
  const rows = await query<UserFilterDbRow>('SELECT * FROM user_filters WHERE id = $1', [id]);
  const row = rows[0];
  return row ? toUserFilterRow(row) : null;
}

export async function findByUserId(userId: number): Promise<UserFilterRow[]> {
  const rows = await query<UserFilterDbRow>(
    `SELECT * FROM user_filters
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(toUserFilterRow);
}

export async function findActiveFilters(): Promise<UserFilterRow[]> {
  const rows = await query<UserFilterDbRow>(
    `SELECT * FROM user_filters
     WHERE is_active = TRUE
     ORDER BY user_id, updated_at DESC`,
  );
  return rows.map(toUserFilterRow);
}

/**
 * Reverse-match: given a listing's attributes, find all active filters
 * that would match it.
 *
 * Uses SQL predicates on the flattened filter columns to efficiently
 * determine which filters a listing satisfies.
 */
/**
 * Pure keyword post-filter for reverse-match results.
 * Delegates to the shared keyword matching module in @immoradar/filtering
 * to guarantee identical semantics with the SQL search path.
 * Exported for unit testing without DB access.
 */
export function filterByKeywords(
  filters: UserFilterRow[],
  title: string | null,
  description: string | null,
): UserFilterRow[] {
  return filters.filter((row) =>
    passesKeywordFilter(title, description, row.requiredKeywords, row.excludedKeywords),
  );
}

export interface ReverseMatchResult {
  /** Filter IDs that passed SQL predicates (before keyword filtering) */
  evaluatedIds: number[];
  /** Filters that passed both SQL predicates and keyword post-filtering */
  matched: UserFilterRow[];
}

export async function findMatchingFilters(listing: {
  operationType: string;
  propertyType: string;
  districtNo: number | null;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  currentScore: number | null;
  title: string | null;
  description: string | null;
}): Promise<ReverseMatchResult> {
  const rows = await query<UserFilterDbRow>(
    `SELECT * FROM user_filters
     WHERE is_active = TRUE
       AND (operation_type IS NULL OR operation_type = $1)
       AND (COALESCE(array_length(property_types, 1), 0) = 0 OR $2 = ANY(property_types))
       AND (COALESCE(array_length(districts, 1), 0) = 0 OR $3::smallint = ANY(districts))
       AND (min_price_eur_cents IS NULL OR $4::bigint >= min_price_eur_cents)
       AND (max_price_eur_cents IS NULL OR $4::bigint <= max_price_eur_cents)
       AND (min_area_sqm IS NULL OR $5::numeric >= min_area_sqm)
       AND (max_area_sqm IS NULL OR $5::numeric <= max_area_sqm)
       AND (min_rooms IS NULL OR $6::numeric >= min_rooms)
       AND (max_rooms IS NULL OR $6::numeric <= max_rooms)
       AND (min_score IS NULL OR $7::numeric >= min_score)
     ORDER BY user_id, id`,
    [
      listing.operationType,
      listing.propertyType,
      listing.districtNo,
      listing.listPriceEurCents,
      listing.livingAreaSqm,
      listing.rooms,
      listing.currentScore,
    ],
  );
  const mapped = rows.map(toUserFilterRow);
  const evaluatedIds = mapped.map((f) => f.id);

  // Post-filter by keywords (can't efficiently do in SQL for reverse match)
  const matched = filterByKeywords(mapped, listing.title, listing.description);
  return { evaluatedIds, matched };
}

// ── Reverse-match metadata updates ──────────────────────────────────────────

export async function updateEvaluatedAt(filterIds: number[]): Promise<void> {
  if (filterIds.length === 0) return;
  await query('UPDATE user_filters SET last_evaluated_at = NOW() WHERE id = ANY($1::bigint[])', [
    filterIds,
  ]);
}

export async function updateMatchedAt(filterIds: number[]): Promise<void> {
  if (filterIds.length === 0) return;
  await query('UPDATE user_filters SET last_match_at = NOW() WHERE id = ANY($1::bigint[])', [
    filterIds,
  ]);
}
