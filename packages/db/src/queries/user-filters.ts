import { query } from '../client.js';
import type {
  UserFilterRow,
  FilterCreateInput,
  FilterCriteria,
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
  deleted_at: Date | null;
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
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Criteria columns ────────────────────────────────────────────────────────

/** The columns one criteria set fills, in the order of `criteriaValues`. */
const CRITERIA_COLUMNS = [
  'operation_type',
  'property_types',
  'districts',
  'postal_codes',
  'min_price_eur_cents',
  'max_price_eur_cents',
  'min_area_sqm',
  'max_area_sqm',
  'min_rooms',
  'max_rooms',
  'required_keywords',
  'excluded_keywords',
  'min_score',
  'sort_by',
  'criteria_json',
] as const;

function eurToCents(eur: number | null | undefined): number | null {
  return eur != null ? Math.round(eur * 100) : null;
}

/**
 * Every criteria column from one criteria set, with the column default for a field the set
 * leaves out. Create and update both write all of them, so an update can't leave a stale bound.
 */
function criteriaValues(criteria: FilterCriteria): unknown[] {
  return [
    criteria.operationType ?? null,
    criteria.propertyTypes ?? [],
    criteria.districts ?? [],
    criteria.postalCodes ?? [],
    eurToCents(criteria.minPriceEur),
    eurToCents(criteria.maxPriceEur),
    criteria.minAreaSqm ?? null,
    criteria.maxAreaSqm ?? null,
    criteria.minRooms ?? null,
    criteria.maxRooms ?? null,
    criteria.requiredKeywords ?? [],
    criteria.excludedKeywords ?? [],
    criteria.minScore ?? null,
    criteria.sortBy ?? 'score_desc',
    JSON.stringify(criteria),
  ];
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function create(input: FilterCreateInput): Promise<UserFilterRow> {
  const columns = [
    'user_id',
    'name',
    'filter_kind',
    'alert_frequency',
    'alert_channels',
    ...CRITERIA_COLUMNS,
  ];
  const params = [
    input.userId,
    input.name,
    input.filterKind,
    input.alertFrequency,
    input.alertChannels,
    ...criteriaValues(input.criteria),
  ];
  const rows = await query<UserFilterDbRow>(
    `INSERT INTO user_filters (${columns.join(', ')})
     VALUES (${params.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`,
    params,
  );
  return toUserFilterRow(rows[0]!);
}

/** Updates a filter that isn't deleted. Returns null for a missing or deleted filter. */
export async function update(id: number, input: FilterUpdateInput): Promise<UserFilterRow | null> {
  const assignments: Array<[string, unknown]> = [];
  if (input.name !== undefined) assignments.push(['name', input.name]);
  if (input.isActive !== undefined) assignments.push(['is_active', input.isActive]);
  if (input.alertFrequency !== undefined) {
    assignments.push(['alert_frequency', input.alertFrequency]);
  }
  if (input.alertChannels !== undefined) assignments.push(['alert_channels', input.alertChannels]);
  if (input.criteria !== undefined) {
    const values = criteriaValues(input.criteria);
    CRITERIA_COLUMNS.forEach((column, i) => assignments.push([column, values[i]]));
  }

  if (assignments.length === 0) {
    const existing = await findById(id);
    return existing && existing.deletedAt == null ? existing : null;
  }

  const rows = await query<UserFilterDbRow>(
    `UPDATE user_filters
     SET ${assignments.map(([column], i) => `${column} = $${i + 2}`).join(', ')}
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...assignments.map(([, value]) => value)],
  );
  const row = rows[0];
  return row ? toUserFilterRow(row) : null;
}

/**
 * Deletes a filter: it leaves the list and stops alerting, and its alerts stay. Returns false
 * when the filter is missing or already deleted.
 */
export async function softDelete(id: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE user_filters
     SET deleted_at = NOW(), is_active = FALSE
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/** Any filter by id, deleted ones included; callers check `deletedAt`. */
export async function findById(id: number): Promise<UserFilterRow | null> {
  const rows = await query<UserFilterDbRow>('SELECT * FROM user_filters WHERE id = $1', [id]);
  const row = rows[0];
  return row ? toUserFilterRow(row) : null;
}

/** The owner's filters that aren't deleted, paused ones included. */
export async function findByUserId(userId: number): Promise<UserFilterRow[]> {
  const rows = await query<UserFilterDbRow>(
    `SELECT * FROM user_filters
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(toUserFilterRow);
}

export async function findActiveFilters(): Promise<UserFilterRow[]> {
  const rows = await query<UserFilterDbRow>(
    `SELECT * FROM user_filters
     WHERE is_active = TRUE AND deleted_at IS NULL
     ORDER BY user_id, updated_at DESC`,
  );
  return rows.map(toUserFilterRow);
}

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

/**
 * Reverse-match: given a listing's attributes, find the filters that alert on it.
 *
 * Only alert filters that are active, not deleted and not set to 'manual' take part. No digest
 * runs yet, so 'hourly_digest' and 'daily_digest' alert like 'instant'. SQL predicates on the
 * flattened filter columns do the matching.
 */
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
       AND deleted_at IS NULL
       AND filter_kind = 'alert'
       AND alert_frequency <> 'manual'
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
