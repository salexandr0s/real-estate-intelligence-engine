import { query } from '../client.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface DeviceTokenDbRow {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  app_version: string | null;
  last_used_at: Date;
  created_at: Date;
}

export interface DeviceTokenRow {
  id: number;
  userId: number;
  token: string;
  platform: string;
  appVersion: string | null;
  lastUsedAt: Date;
  createdAt: Date;
}

function toDeviceTokenRow(row: DeviceTokenDbRow): DeviceTokenRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    token: row.token,
    platform: row.platform,
    appVersion: row.app_version,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Register or refresh a device token for push notifications.
 * On conflict (same user + token), updates last_used_at and app_version.
 */
export async function upsert(
  userId: number,
  token: string,
  platform: string,
  appVersion?: string,
): Promise<DeviceTokenRow> {
  const rows = await query<DeviceTokenDbRow>(
    `INSERT INTO device_tokens (user_id, token, platform, app_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, token) DO UPDATE
       SET last_used_at = NOW(),
           app_version = EXCLUDED.app_version
     RETURNING *`,
    [userId, token, platform, appVersion ?? null],
  );
  return toDeviceTokenRow(rows[0]!);
}

/**
 * Find all device tokens for a user, most recently used first.
 */
export async function findByUser(userId: number): Promise<DeviceTokenRow[]> {
  const rows = await query<DeviceTokenDbRow>(
    `SELECT * FROM device_tokens
     WHERE user_id = $1
     ORDER BY last_used_at DESC`,
    [userId],
  );
  return rows.map(toDeviceTokenRow);
}

/**
 * Remove a specific token (e.g. APNs invalid-token cleanup).
 * Not user-scoped — used internally when APNs reports a token as unregistered.
 * Returns true if a row was deleted.
 */
export async function removeByToken(token: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM device_tokens
     WHERE token = $1
     RETURNING id`,
    [token],
  );
  return rows.length > 0;
}

/**
 * Remove a token owned by a specific user.
 * Used by the API endpoint to ensure users can only delete their own tokens.
 */
export async function removeByUserAndToken(userId: number, token: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM device_tokens
     WHERE user_id = $1 AND token = $2
     RETURNING id`,
    [userId, token],
  );
  return rows.length > 0;
}

/**
 * Remove stale tokens that haven't been used since the given date.
 * Returns the number of rows deleted.
 */
export async function removeStale(olderThan: Date): Promise<number> {
  const rows = await query(
    `DELETE FROM device_tokens
     WHERE last_used_at < $1
     RETURNING id`,
    [olderThan],
  );
  return rows.length;
}

/**
 * Count all active device tokens across all users.
 * Used to populate the pushTokensActive gauge.
 */
export async function countAll(): Promise<number> {
  interface CountResult {
    count: string;
  }
  const rows = await query<CountResult>('SELECT COUNT(*) AS count FROM device_tokens', []);
  return Number(rows[0]?.count ?? 0);
}
