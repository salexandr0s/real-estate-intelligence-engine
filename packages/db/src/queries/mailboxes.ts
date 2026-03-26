import { query } from '../client.js';
import type { MailboxAccountRow, MailboxSyncStatus } from '@immoradar/contracts';

interface MailboxDbRow {
  id: string;
  user_id: string;
  provider_code: 'imap_smtp';
  mode: 'shared_env';
  email: string;
  display_name: string | null;
  secret_ref: string;
  is_active: boolean;
  sync_status: MailboxSyncStatus;
  poll_interval_seconds: number;
  last_sync_started_at: Date | null;
  last_sync_completed_at: Date | null;
  last_successful_sync_at: Date | null;
  last_seen_uid: string | null;
  last_seen_uidvalidity: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRow(row: MailboxDbRow): MailboxAccountRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    providerCode: row.provider_code,
    mode: row.mode,
    email: row.email,
    displayName: row.display_name,
    secretRef: row.secret_ref,
    isActive: row.is_active,
    syncStatus: row.sync_status,
    pollIntervalSeconds: row.poll_interval_seconds,
    lastSyncStartedAt: row.last_sync_started_at,
    lastSyncCompletedAt: row.last_sync_completed_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastSeenUid: row.last_seen_uid != null ? Number(row.last_seen_uid) : null,
    lastSeenUidvalidity:
      row.last_seen_uidvalidity != null ? Number(row.last_seen_uidvalidity) : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureSharedMailbox(input: {
  userId: number;
  email: string;
  displayName?: string | null;
  secretRef: string;
  pollIntervalSeconds: number;
}): Promise<MailboxAccountRow> {
  const rows = await query<MailboxDbRow>(
    `INSERT INTO mailbox_accounts (
       user_id, email, display_name, secret_ref, poll_interval_seconds, provider_code, mode, is_active
     ) VALUES ($1, $2, $3, $4, $5, 'imap_smtp', 'shared_env', TRUE)
     ON CONFLICT (user_id, email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       secret_ref = EXCLUDED.secret_ref,
       poll_interval_seconds = EXCLUDED.poll_interval_seconds,
       is_active = TRUE,
       updated_at = NOW()
     RETURNING *`,
    [
      input.userId,
      input.email,
      input.displayName ?? null,
      input.secretRef,
      input.pollIntervalSeconds,
    ],
  );
  return toRow(rows[0]!);
}

export async function findByUser(userId: number): Promise<MailboxAccountRow[]> {
  const rows = await query<MailboxDbRow>(
    `SELECT * FROM mailbox_accounts
     WHERE user_id = $1
     ORDER BY updated_at DESC, id DESC`,
    [userId],
  );
  return rows.map(toRow);
}

export async function findById(id: number): Promise<MailboxAccountRow | null> {
  const rows = await query<MailboxDbRow>('SELECT * FROM mailbox_accounts WHERE id = $1', [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function findByIdForUser(
  id: number,
  userId: number,
): Promise<MailboxAccountRow | null> {
  const rows = await query<MailboxDbRow>(
    'SELECT * FROM mailbox_accounts WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function markSyncStarted(id: number): Promise<void> {
  await query(
    `UPDATE mailbox_accounts
     SET sync_status = 'syncing',
         last_sync_started_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
}

export async function markSyncFinished(
  id: number,
  input: {
    status: MailboxSyncStatus;
    lastSeenUid?: number | null;
    lastSeenUidvalidity?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await query(
    `UPDATE mailbox_accounts
     SET sync_status = $2,
         last_sync_completed_at = NOW(),
         last_successful_sync_at = CASE WHEN $2 IN ('healthy', 'degraded') THEN NOW() ELSE last_successful_sync_at END,
         last_seen_uid = COALESCE($3, last_seen_uid),
         last_seen_uidvalidity = COALESCE($4, last_seen_uidvalidity),
         last_error_code = $5,
         last_error_message = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      input.status,
      input.lastSeenUid ?? null,
      input.lastSeenUidvalidity ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
    ],
  );
}
