import { query } from '../client.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface AppUserDbRow {
  id: string;
  email: string | null;
  display_name: string;
  timezone: string;
  locale: string;
  is_active: boolean;
  notification_settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface AppUserRow {
  id: number;
  email: string | null;
  displayName: string;
  timezone: string;
  locale: string;
  isActive: boolean;
  notificationSettings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function toAppUserRow(row: AppUserDbRow): AppUserRow {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    timezone: row.timezone,
    locale: row.locale,
    isActive: row.is_active,
    notificationSettings: row.notification_settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Find an app user by ID. Returns null if not found.
 */
export async function findById(userId: number): Promise<AppUserRow | null> {
  const rows = await query<AppUserDbRow>('SELECT * FROM app_users WHERE id = $1', [userId]);
  const row = rows[0];
  return row ? toAppUserRow(row) : null;
}

/**
 * Find just the email address for a user. Returns null if user not found or has no email.
 */
export async function findEmail(userId: number): Promise<string | null> {
  interface EmailResult {
    email: string | null;
  }
  const rows = await query<EmailResult>('SELECT email FROM app_users WHERE id = $1', [userId]);
  return rows[0]?.email ?? null;
}
