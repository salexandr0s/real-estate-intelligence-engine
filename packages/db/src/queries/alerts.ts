import { query } from '../client.js';
import type { AlertCreate, AlertRow, AlertStatus, AlertType, AlertChannel } from '@rei/contracts';

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
 * Check if a cluster-aware alert already exists for a given filter + cluster + type.
 * Used to suppress duplicate alerts for the same property across multiple sources.
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
     ) AS exists`,
    [userFilterId, clusterFingerprint, alertType],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Find alerts for a user with optional status filter and cursor pagination.
 */
export async function findByUser(
  userId: number,
  status: AlertStatus | null,
  cursor: string | null,
  limit = 25,
): Promise<{ data: AlertRow[]; nextCursor: string | null }> {
  const cursorId = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : null;

  const rows = await query<AlertDbRow>(
    `SELECT a.*, uf.name AS filter_name
     FROM alerts a
     LEFT JOIN user_filters uf ON a.user_filter_id = uf.id
     WHERE a.user_id = $1
       AND ($2::text IS NULL OR a.status = $2)
       AND ($3::bigint IS NULL OR a.id < $3)
     ORDER BY a.id DESC
     LIMIT $4`,
    [userId, status, cursorId, limit + 1],
  );

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const data = resultRows.map(toAlertRow);

  let nextCursorOut: string | null = null;
  if (hasMore && resultRows.length > 0) {
    const lastRow = resultRows[resultRows.length - 1]!;
    nextCursorOut = Buffer.from(lastRow.id).toString('base64url');
  }

  return { data, nextCursor: nextCursorOut };
}

/**
 * Find a single alert by ID.
 */
export async function findById(id: number): Promise<AlertRow | null> {
  const rows = await query<AlertDbRow>('SELECT * FROM alerts WHERE id = $1', [id]);
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
  const rows = await query<AlertDbRow>(
    `UPDATE alerts
     SET status = $2,
         sent_at = COALESCE($3, sent_at),
         error_message = COALESCE($4, error_message)
     WHERE id = $1
     RETURNING *`,
    [id, status, sentAt ?? null, errorMessage ?? null],
  );
  const row = rows[0];
  return row ? toAlertRow(row) : null;
}

/**
 * Count unread (queued + sent but not opened/dismissed) alerts for a user.
 */
export async function countUnread(userId: number): Promise<number> {
  interface CountResult {
    count: string;
  }
  const rows = await query<CountResult>(
    `SELECT COUNT(*) AS count FROM alerts
     WHERE user_id = $1
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
 * Bulk-update alert status for all alerts matching a user + optional current status filter.
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
       AND ($2::text IS NULL OR status = $2)
     RETURNING id`,
    [userId, currentStatus, newStatus],
  );
  return rows.length;
}

/**
 * Find alerts for a user matched since a given timestamp.
 * Used by the SSE stream endpoint to poll for new alerts.
 */
export async function findSince(userId: number, since: Date, limit = 100): Promise<AlertRow[]> {
  const rows = await query<AlertDbRow>(
    `SELECT * FROM alerts
     WHERE user_id = $1 AND matched_at > $2
     ORDER BY matched_at ASC
     LIMIT $3`,
    [userId, since, limit],
  );
  return rows.map(toAlertRow);
}
