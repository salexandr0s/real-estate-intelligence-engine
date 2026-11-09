import { query } from '../client.js';
import type {
  AlertCreate,
  AlertListingSummary,
  AlertRow,
  AlertStatus,
  AlertType,
  AlertChannel,
} from '@immoradar/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface AlertDbRow {
  id: string;
  user_id: string;
  user_filter_id: string;
  listing_id: string;
  listing_version_id: string | null;
  alert_type: AlertType;
  channel: AlertChannel;
  status: AlertStatus;
  dedupe_key: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  match_reasons_json: Record<string, unknown> | null;
  cluster_fingerprint: string | null;
  matched_at: Date;
  scheduled_for: Date;
  sent_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  filter_name?: string | null;
  listing_listing_uid?: string | null;
  listing_source_code?: string | null;
  listing_canonical_url?: string | null;
  listing_title?: string | null;
  listing_operation_type?: string | null;
  listing_property_type?: string | null;
  listing_city?: string | null;
  listing_postal_code?: string | null;
  listing_district_no?: number | null;
  listing_district_name?: string | null;
  listing_list_price_eur_cents?: string | null;
  listing_living_area_sqm?: string | null;
  listing_rooms?: string | null;
  listing_price_per_sqm_eur?: string | null;
  listing_current_score?: string | null;
  listing_first_seen_at?: Date | null;
  listing_listing_status?: string | null;
  listing_latitude?: string | null;
  listing_longitude?: string | null;
  listing_geocode_precision?: string | null;
  listing_last_price_change_pct?: string | null;
  listing_last_price_change_at?: Date | null;
}

/** A row of the alert list, with its sort key as Postgres printed it (null when missing). */
interface AlertListDbRow extends AlertDbRow {
  sort_key: string | null;
}

const ALERT_SELECT_WITH_LISTING = `
  a.*,
  uf.name AS filter_name,
  l.listing_uid AS listing_listing_uid,
  s.code AS listing_source_code,
  l.canonical_url AS listing_canonical_url,
  l.title AS listing_title,
  l.operation_type AS listing_operation_type,
  l.property_type AS listing_property_type,
  l.city AS listing_city,
  l.postal_code AS listing_postal_code,
  l.district_no AS listing_district_no,
  l.district_name AS listing_district_name,
  l.list_price_eur_cents AS listing_list_price_eur_cents,
  l.living_area_sqm AS listing_living_area_sqm,
  l.rooms AS listing_rooms,
  l.price_per_sqm_eur AS listing_price_per_sqm_eur,
  l.current_score AS listing_current_score,
  l.first_seen_at AS listing_first_seen_at,
  l.listing_status AS listing_listing_status,
  l.latitude AS listing_latitude,
  l.longitude AS listing_longitude,
  l.geocode_precision AS listing_geocode_precision,
  pc.price_change_pct AS listing_last_price_change_pct,
  pc.observed_at AS listing_last_price_change_at
`;

const ALERT_LISTING_JOIN = `
  LEFT JOIN user_filters uf ON a.user_filter_id = uf.id
  LEFT JOIN listings l ON a.listing_id = l.id
  LEFT JOIN sources s ON l.source_id = s.id
  LEFT JOIN LATERAL (
    SELECT
      v.observed_at,
      CASE
        WHEN prev.list_price_eur_cents IS NOT NULL AND prev.list_price_eur_cents > 0
        THEN ROUND(
          ((v.list_price_eur_cents - prev.list_price_eur_cents)::numeric
            / prev.list_price_eur_cents) * 100, 2
        )
        ELSE NULL
      END AS price_change_pct
    FROM listing_versions v
    LEFT JOIN LATERAL (
      SELECT pv.list_price_eur_cents
      FROM listing_versions pv
      WHERE pv.listing_id = l.id
        AND pv.version_no < v.version_no
        AND pv.list_price_eur_cents IS NOT NULL
      ORDER BY pv.version_no DESC
      LIMIT 1
    ) prev ON true
    WHERE v.listing_id = l.id
      AND v.version_reason = 'price_change'
    ORDER BY v.version_no DESC
    LIMIT 1
  ) pc ON true
`;

/**
 * The app's alert inbox is the in_app channel. Every other channel gets its own copy of the
 * same alert, with a delivery status ('sent', 'failed') instead of a read status, so the inbox
 * queries leave those copies out.
 */
const INBOX_CHANNEL = 'in_app';

export type AlertSortBy = 'age' | 'district' | 'price';
export type AlertSortDirection = 'asc' | 'desc';

export interface AlertListOptions {
  sortBy?: AlertSortBy;
  sortDirection?: AlertSortDirection;
  /** Only the alerts of this filter. */
  userFilterId?: number | null;
}

interface AlertCursorPayload {
  sortBy: AlertSortBy;
  sortDirection: AlertSortDirection;
  id: number;
  /**
   * The last row's sort key as Postgres printed it, so the cursor loses no precision. Null when
   * that row had no district or price.
   */
  key: string | null;
}

/**
 * The sort key per mode. Alerts without a district or price have a NULL key, which sorts last
 * in both directions whatever the database collation.
 */
function alertSortKey(sortBy: AlertSortBy): {
  expr: string;
  type: 'timestamptz' | 'text' | 'bigint';
  nullable: boolean;
} {
  switch (sortBy) {
    case 'district':
      return {
        expr: `COALESCE(NULLIF(l.district_name, ''), NULLIF(l.city, ''))`,
        type: 'text',
        nullable: true,
      };
    case 'price':
      return { expr: 'l.list_price_eur_cents', type: 'bigint', nullable: true };
    case 'age':
      return { expr: 'a.matched_at', type: 'timestamptz', nullable: false };
  }
}

function toAlertListing(row: AlertDbRow): AlertListingSummary | null {
  return {
    id: Number(row.listing_id),
    listingUid: row.listing_listing_uid ?? null,
    sourceCode: row.listing_source_code ?? null,
    canonicalUrl: row.listing_canonical_url ?? null,
    title: row.listing_title ?? null,
    operationType: row.listing_operation_type ?? null,
    propertyType: row.listing_property_type ?? null,
    city: row.listing_city ?? null,
    postalCode: row.listing_postal_code ?? null,
    districtNo: row.listing_district_no ?? null,
    districtName: row.listing_district_name ?? null,
    listPriceEurCents:
      row.listing_list_price_eur_cents != null ? Number(row.listing_list_price_eur_cents) : null,
    livingAreaSqm: row.listing_living_area_sqm != null ? Number(row.listing_living_area_sqm) : null,
    rooms: row.listing_rooms != null ? Number(row.listing_rooms) : null,
    pricePerSqmEur:
      row.listing_price_per_sqm_eur != null ? Number(row.listing_price_per_sqm_eur) : null,
    currentScore: row.listing_current_score != null ? Number(row.listing_current_score) : null,
    firstSeenAt: row.listing_first_seen_at ?? null,
    listingStatus: row.listing_listing_status ?? null,
    latitude: row.listing_latitude != null ? Number(row.listing_latitude) : null,
    longitude: row.listing_longitude != null ? Number(row.listing_longitude) : null,
    geocodePrecision: row.listing_geocode_precision ?? null,
    lastPriceChangePct:
      row.listing_last_price_change_pct != null ? Number(row.listing_last_price_change_pct) : null,
    lastPriceChangeAt: row.listing_last_price_change_at ?? null,
  };
}

function toAlertRow(row: AlertDbRow): AlertRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    userFilterId: Number(row.user_filter_id),
    listingId: Number(row.listing_id),
    listingVersionId: row.listing_version_id != null ? Number(row.listing_version_id) : null,
    alertType: row.alert_type,
    channel: row.channel,
    status: row.status,
    dedupeKey: row.dedupe_key,
    title: row.title,
    body: row.body,
    payload: row.payload,
    matchReasons: (row.match_reasons_json as AlertRow['matchReasons']) ?? null,
    clusterFingerprint: row.cluster_fingerprint,
    matchedAt: row.matched_at,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    filterName: row.filter_name ?? null,
    listing: toAlertListing(row),
  };
}

function decodeAlertCursor(cursor: string | null): AlertCursorPayload | null {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as AlertCursorPayload;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      (decoded.sortBy !== 'age' && decoded.sortBy !== 'district' && decoded.sortBy !== 'price') ||
      (decoded.sortDirection !== 'asc' && decoded.sortDirection !== 'desc') ||
      typeof decoded.id !== 'number' ||
      (typeof decoded.key !== 'string' && decoded.key !== null)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function buildNextAlertCursor(
  row: Pick<AlertListDbRow, 'id' | 'sort_key'>,
  sortBy: AlertSortBy,
  sortDirection: AlertSortDirection,
): string {
  const payload: AlertCursorPayload = {
    sortBy,
    sortDirection,
    id: Number(row.id),
    key: row.sort_key,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function buildAlertSortSpec(
  sortBy: AlertSortBy = 'age',
  sortDirection: AlertSortDirection = 'desc',
  cursor: string | null,
): {
  sortKeySql: string;
  cursorValues: [string | null, number | null];
  cursorWhere: string;
  orderBy: string;
} {
  const { expr, type, nullable } = alertSortKey(sortBy);
  const decodedCursor = decodeAlertCursor(cursor);
  const parsedCursor =
    decodedCursor?.sortBy === sortBy &&
    decodedCursor.sortDirection === sortDirection &&
    (nullable || decodedCursor.key !== null)
      ? decodedCursor
      : null;
  const direction = sortDirection.toUpperCase();
  const after = sortDirection === 'asc' ? '>' : '<';
  const pastCursor = `(${expr}, a.id) ${after} ($3::${type}, $4::bigint)`;

  // $4 (the cursor id) is null on the first page. A NULL key compares as unknown, so rows
  // without a district or price are matched on their own after the keyed rows.
  const cursorWhere = nullable
    ? `AND ($4::bigint IS NULL
        OR ($3::${type} IS NULL AND ${expr} IS NULL AND a.id ${after} $4::bigint)
        OR ($3::${type} IS NOT NULL AND (${pastCursor} OR ${expr} IS NULL)))`
    : `AND ($4::bigint IS NULL OR ${pastCursor})`;

  return {
    sortKeySql: expr,
    cursorValues: [parsedCursor?.key ?? null, parsedCursor?.id ?? null],
    cursorWhere,
    orderBy: `ORDER BY ${expr} ${direction}${nullable ? ' NULLS LAST' : ''}, a.id ${direction}`,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Create an alert with ON CONFLICT (dedupe_key, channel) DO NOTHING.
 * Returns the alert row if inserted, or null if deduplicated.
 */
export async function create(input: AlertCreate): Promise<AlertRow | null> {
  const rows = await query<AlertDbRow>(
    `INSERT INTO alerts (
       user_id, user_filter_id, listing_id, listing_version_id,
       alert_type, channel, dedupe_key,
       title, body, payload, scheduled_for,
       match_reasons_json, cluster_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (dedupe_key, channel) DO NOTHING
     RETURNING *`,
    [
      input.userId,
      input.userFilterId,
      input.listingId,
      input.listingVersionId ?? null,
      input.alertType,
      input.channel,
      input.dedupeKey,
      input.title,
      input.body,
      JSON.stringify(input.payload ?? {}),
      input.scheduledFor ?? new Date(),
      input.matchReasons ? JSON.stringify(input.matchReasons) : null,
      input.clusterFingerprint ?? null,
    ],
  );
  const row = rows[0];
  return row ? toAlertRow(row) : null;
}

/**
 * Check if a cluster-aware alert exists for a given filter + cluster + type.
 * Used to suppress duplicate alerts for the same property across multiple sources.
 * Only alerts matched in the last 30 days count, so one old alert can't silence
 * a cluster forever.
 */
export async function existsForCluster(
  userFilterId: number,
  clusterFingerprint: string,
  alertType: AlertType,
): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM alerts
       WHERE user_filter_id = $1
         AND cluster_fingerprint = $2
         AND alert_type = $3
         AND matched_at >= NOW() - INTERVAL '30 days'
     ) AS exists`,
    [userFilterId, clusterFingerprint, alertType],
  );
  return rows[0]?.exists ?? false;
}

/**
 * A page of the user's inbox alerts, with an optional status and filter, and cursor pagination.
 */
export async function findByUser(
  userId: number,
  status: AlertStatus | null,
  cursor: string | null,
  limit = 25,
  options: AlertListOptions = {},
): Promise<{ data: AlertRow[]; nextCursor: string | null }> {
  const sortBy = options.sortBy ?? 'age';
  const sortDirection = options.sortDirection ?? 'desc';
  const { sortKeySql, cursorValues, cursorWhere, orderBy } = buildAlertSortSpec(
    sortBy,
    sortDirection,
    cursor,
  );

  const rows = await query<AlertListDbRow>(
    `SELECT ${ALERT_SELECT_WITH_LISTING}, (${sortKeySql})::text AS sort_key
     FROM alerts a
     ${ALERT_LISTING_JOIN}
     WHERE a.user_id = $1
       AND a.channel = '${INBOX_CHANNEL}'
       AND ($2::text IS NULL OR a.status = $2)
       AND ($6::bigint IS NULL OR a.user_filter_id = $6)
       ${cursorWhere}
     ${orderBy}
     LIMIT $5`,
    [userId, status, ...cursorValues, limit + 1, options.userFilterId ?? null],
  );

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const data = resultRows.map(toAlertRow);

  let nextCursorOut: string | null = null;
  if (hasMore && resultRows.length > 0) {
    const lastRow = resultRows[resultRows.length - 1]!;
    nextCursorOut = buildNextAlertCursor(lastRow, sortBy, sortDirection);
  }

  return { data, nextCursor: nextCursorOut };
}

/**
 * Find a single alert by ID.
 */
export async function findById(id: number): Promise<AlertRow | null> {
  const rows = await query<AlertDbRow>(
    `SELECT ${ALERT_SELECT_WITH_LISTING}
     FROM alerts a
     ${ALERT_LISTING_JOIN}
     WHERE a.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toAlertRow(row) : null;
}

/**
 * Update alert status. Optionally sets sent_at or error_message.
 */
export async function updateStatus(
  id: number,
  status: AlertStatus,
  sentAt?: Date,
  errorMessage?: string,
): Promise<AlertRow | null> {
  const rows = await query<{ id: string }>(
    `UPDATE alerts
     SET status = $2,
         sent_at = COALESCE($3, sent_at),
         error_message = COALESCE($4, error_message)
     WHERE id = $1
     RETURNING id`,
    [id, status, sentAt ?? null, errorMessage ?? null],
  );
  const updatedId = rows[0]?.id;
  return updatedId ? findById(Number(updatedId)) : null;
}

/**
 * Count unread (queued + sent but not opened/dismissed) inbox alerts for a user.
 */
export async function countUnread(userId: number): Promise<number> {
  interface CountResult {
    count: string;
  }
  const rows = await query<CountResult>(
    `SELECT COUNT(*) AS count FROM alerts
     WHERE user_id = $1
       AND channel = '${INBOX_CHANNEL}'
       AND status IN ('queued', 'sent')`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Bulk-update alert status for specific IDs owned by a user.
 */
export async function bulkUpdateStatus(
  ids: number[],
  status: AlertStatus,
  userId: number,
): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE alerts
     SET status = $1, updated_at = NOW()
     WHERE id = ANY($2::bigint[])
       AND user_id = $3
     RETURNING id`,
    [status, ids, userId],
  );
  return rows.length;
}

/**
 * Bulk-update the status of a user's inbox alerts, optionally only those in one status. Other
 * channels keep their delivery status.
 */
export async function bulkUpdateByFilter(
  userId: number,
  currentStatus: AlertStatus | null,
  newStatus: AlertStatus,
): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE alerts
     SET status = $3, updated_at = NOW()
     WHERE user_id = $1
       AND channel = '${INBOX_CHANNEL}'
       AND ($2::text IS NULL OR status = $2)
     RETURNING id`,
    [userId, currentStatus, newStatus],
  );
  return rows.length;
}

/**
 * Find a user's inbox alerts matched since a given timestamp.
 * Used by the SSE stream endpoint to poll for new alerts.
 */
export async function findSince(userId: number, since: Date, limit = 100): Promise<AlertRow[]> {
  const rows = await query<AlertDbRow>(
    `SELECT ${ALERT_SELECT_WITH_LISTING}
     FROM alerts a
     ${ALERT_LISTING_JOIN}
     WHERE a.user_id = $1
       AND a.channel = '${INBOX_CHANNEL}'
       AND a.matched_at > $2
     ORDER BY a.matched_at ASC
     LIMIT $3`,
    [userId, since, limit],
  );
  return rows.map(toAlertRow);
}
