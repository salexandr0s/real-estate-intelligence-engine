import type { PoolClient } from 'pg';
import { query, queryWithClient, transaction } from '../client.js';
import type {
  OutreachEventRow,
  OutreachMatchStrategy,
  OutreachMessageKind,
  OutreachMessageRow,
  OutreachSummary,
  OutreachThreadRow,
  OutreachThreadScope,
  OutreachThreadSummary,
  OutreachWorkflowState,
} from '@immoradar/contracts';

interface OutreachThreadDbRow {
  id: string;
  user_id: string;
  listing_id: string;
  mailbox_account_id: string;
  contact_name: string | null;
  contact_company: string | null;
  contact_email: string;
  contact_phone: string | null;
  workflow_state: OutreachWorkflowState;
  last_outbound_at: Date | null;
  last_inbound_at: Date | null;
  next_action_at: Date | null;
  auto_followup_count: number;
  created_at: Date;
  updated_at: Date;
  unread_inbound_count?: string;
}

interface OutreachMessageDbRow {
  id: string;
  thread_id: string | null;
  mailbox_account_id: string;
  direction: 'outbound' | 'inbound';
  message_kind: OutreachMessageKind;
  delivery_status: 'draft' | 'queued' | 'sent' | 'received' | 'failed' | 'suppressed';
  provider_message_id: string | null;
  imap_uid: string | null;
  imap_uidvalidity: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  from_email: string | null;
  to_email: string | null;
  cc_json: string[];
  bcc_json: string[];
  match_strategy: OutreachMatchStrategy;
  storage_key: string | null;
  checksum: string | null;
  error_message: string | null;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface OutreachEventDbRow {
  id: string;
  thread_id: string;
  message_id: string | null;
  event_type: string;
  from_state: OutreachWorkflowState | null;
  to_state: OutreachWorkflowState | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

interface AttachmentRow {
  message_id: string;
  document_id: string;
  label: string | null;
  status: string;
}

function toThreadRow(row: OutreachThreadDbRow): OutreachThreadRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    listingId: Number(row.listing_id),
    mailboxAccountId: Number(row.mailbox_account_id),
    contactName: row.contact_name,
    contactCompany: row.contact_company,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    workflowState: row.workflow_state,
    lastOutboundAt: row.last_outbound_at,
    lastInboundAt: row.last_inbound_at,
    nextActionAt: row.next_action_at,
    autoFollowupCount: row.auto_followup_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toThreadSummary(row: OutreachThreadDbRow): OutreachThreadSummary {
  const thread = toThreadRow(row);
  return {
    id: thread.id,
    listingId: thread.listingId,
    mailboxAccountId: thread.mailboxAccountId,
    contactName: thread.contactName,
    contactCompany: thread.contactCompany,
    contactEmail: thread.contactEmail,
    contactPhone: thread.contactPhone,
    workflowState: thread.workflowState,
    unreadInboundCount: Number(row.unread_inbound_count ?? 0),
    nextActionAt: thread.nextActionAt?.toISOString() ?? null,
    lastInboundAt: thread.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: thread.lastOutboundAt?.toISOString() ?? null,
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function toMessageRow(row: OutreachMessageDbRow): OutreachMessageRow {
  return {
    id: Number(row.id),
    threadId: row.thread_id != null ? Number(row.thread_id) : null,
    mailboxAccountId: Number(row.mailbox_account_id),
    direction: row.direction,
    messageKind: row.message_kind,
    deliveryStatus: row.delivery_status,
    providerMessageId: row.provider_message_id,
    imapUid: row.imap_uid != null ? Number(row.imap_uid) : null,
    imapUidvalidity: row.imap_uidvalidity != null ? Number(row.imap_uidvalidity) : null,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    fromEmail: row.from_email,
    toEmail: row.to_email,
    cc: Array.isArray(row.cc_json) ? row.cc_json : [],
    bcc: Array.isArray(row.bcc_json) ? row.bcc_json : [],
    matchStrategy: row.match_strategy,
    storageKey: row.storage_key,
    checksum: row.checksum,
    errorMessage: row.error_message,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEventRow(row: OutreachEventDbRow): OutreachEventRow {
  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    messageId: row.message_id != null ? Number(row.message_id) : null,
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}

function encodeCursor(row: OutreachThreadDbRow): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: row.updated_at.toISOString(), id: row.id }),
  ).toString('base64url');
}

function decodeCursor(cursor: string | null): { updatedAt: string; id: number } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      updatedAt: string;
      id: number;
    };
    if (!parsed.updatedAt || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function createThreadWithInitialDraft(input: {
  userId: number;
  listingId: number;
  mailboxAccountId: number;
  contactName?: string | null;
  contactCompany?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  subject: string;
  bodyText: string;
  fromEmail: string;
}): Promise<{ thread: OutreachThreadRow; message: OutreachMessageRow }> {
  return transaction(async (client) => {
    const threadRows = await queryWithClient<OutreachThreadDbRow>(
      client,
      `INSERT INTO outreach_threads (
         user_id, listing_id, mailbox_account_id,
         contact_name, contact_company, contact_email, contact_phone,
         workflow_state
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING *`,
      [
        input.userId,
        input.listingId,
        input.mailboxAccountId,
        input.contactName ?? null,
        input.contactCompany ?? null,
        input.contactEmail,
        input.contactPhone ?? null,
      ],
    );
    const thread = toThreadRow(threadRows[0]!);

    const messageRows = await queryWithClient<OutreachMessageDbRow>(
      client,
      `INSERT INTO outreach_messages (
         thread_id, mailbox_account_id, direction, message_kind, delivery_status,
         subject, body_text, from_email, to_email, match_strategy
       ) VALUES ($1, $2, 'outbound', 'initial', 'draft', $3, $4, $5, $6, 'manual')
       RETURNING *`,
      [
        thread.id,
        input.mailboxAccountId,
        input.subject,
        input.bodyText,
        input.fromEmail,
        input.contactEmail,
      ],
    );
    const message = toMessageRow(messageRows[0]!);

    await appendEventWithClient(client, {
      threadId: thread.id,
      messageId: message.id,
      eventType: 'thread_created',
      fromState: null,
      toState: 'draft',
      payload: { listingId: input.listingId },
    });

    return { thread, message };
  });
}

async function appendEventWithClient(
  client: PoolClient,
  input: {
    threadId: number;
    messageId?: number | null;
    eventType: string;
    fromState?: OutreachWorkflowState | null;
    toState?: OutreachWorkflowState | null;
    payload?: Record<string, unknown>;
  },
): Promise<OutreachEventRow> {
  const rows = await queryWithClient<OutreachEventDbRow>(
    client,
    `INSERT INTO outreach_events (thread_id, message_id, event_type, from_state, to_state, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.threadId,
      input.messageId ?? null,
      input.eventType,
      input.fromState ?? null,
      input.toState ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return toEventRow(rows[0]!);
}

export async function appendEvent(input: {
  threadId: number;
  messageId?: number | null;
  eventType: string;
  fromState?: OutreachWorkflowState | null;
  toState?: OutreachWorkflowState | null;
  payload?: Record<string, unknown>;
}): Promise<OutreachEventRow> {
  const rows = await query<OutreachEventDbRow>(
    `INSERT INTO outreach_events (thread_id, message_id, event_type, from_state, to_state, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.threadId,
      input.messageId ?? null,
      input.eventType,
      input.fromState ?? null,
      input.toState ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return toEventRow(rows[0]!);
}

export async function updateThreadState(input: {
  threadId: number;
  workflowState: OutreachWorkflowState;
  lastOutboundAt?: Date | null;
  lastInboundAt?: Date | null;
  nextActionAt?: Date | null;
  autoFollowupCount?: number;
}): Promise<OutreachThreadRow | null> {
  const rows = await query<OutreachThreadDbRow>(
    `UPDATE outreach_threads
     SET workflow_state = $2,
         last_outbound_at = CASE WHEN $3::timestamptz IS NULL THEN last_outbound_at ELSE $3 END,
         last_inbound_at = CASE WHEN $4::timestamptz IS NULL THEN last_inbound_at ELSE $4 END,
         next_action_at = $5,
         auto_followup_count = COALESCE($6, auto_followup_count),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      input.threadId,
      input.workflowState,
      input.lastOutboundAt ?? null,
      input.lastInboundAt ?? null,
      input.nextActionAt ?? null,
      input.autoFollowupCount ?? null,
    ],
  );
  return rows[0] ? toThreadRow(rows[0]) : null;
}

export async function findOpenThreadByListingContact(
  userId: number,
  listingId: number,
  contactEmail: string,
): Promise<OutreachThreadRow | null> {
  const rows = await query<OutreachThreadDbRow>(
    `SELECT * FROM outreach_threads
     WHERE user_id = $1 AND listing_id = $2 AND contact_email = $3 AND workflow_state <> 'closed'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [userId, listingId, contactEmail],
  );
  return rows[0] ? toThreadRow(rows[0]) : null;
}

export async function findThreadById(id: number): Promise<OutreachThreadRow | null> {
  const rows = await query<OutreachThreadDbRow>('SELECT * FROM outreach_threads WHERE id = $1', [
    id,
  ]);
  return rows[0] ? toThreadRow(rows[0]) : null;
}

export async function findThreadByIdForUser(
  id: number,
  userId: number,
): Promise<OutreachThreadRow | null> {
  const rows = await query<OutreachThreadDbRow>(
    'SELECT * FROM outreach_threads WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return rows[0] ? toThreadRow(rows[0]) : null;
}

export async function findSummaryForListing(
  userId: number,
  listingId: number,
): Promise<OutreachSummary | null> {
  const rows = await query<OutreachThreadDbRow>(
    `SELECT t.*,
            (
              SELECT COUNT(*)::text FROM outreach_messages m
              WHERE m.thread_id = t.id
                AND m.direction = 'inbound'
                AND m.delivery_status = 'received'
                AND (t.last_outbound_at IS NULL OR m.occurred_at > t.last_outbound_at)
            ) AS unread_inbound_count
     FROM outreach_threads t
     WHERE t.user_id = $1 AND t.listing_id = $2 AND t.workflow_state <> 'closed'
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT 1`,
    [userId, listingId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    threadId: Number(row.id),
    workflowState: row.workflow_state,
    unreadInboundCount: Number(row.unread_inbound_count ?? 0),
    nextActionAt: row.next_action_at?.toISOString() ?? null,
    lastInboundAt: row.last_inbound_at?.toISOString() ?? null,
    lastOutboundAt: row.last_outbound_at?.toISOString() ?? null,
  };
}

export async function findThreadsByUser(
  userId: number,
  scope: OutreachThreadScope,
  cursor: string | null,
  limit = 25,
): Promise<{ data: OutreachThreadSummary[]; nextCursor: string | null }> {
  const decoded = decodeCursor(cursor);
  const scopePredicate =
    scope === 'closed'
      ? `AND t.workflow_state = 'closed'`
      : scope === 'open'
        ? `AND t.workflow_state <> 'closed'`
        : '';

  const rows = await query<OutreachThreadDbRow>(
    `SELECT t.*,
            (
              SELECT COUNT(*)::text FROM outreach_messages m
              WHERE m.thread_id = t.id
                AND m.direction = 'inbound'
                AND m.delivery_status = 'received'
                AND (t.last_outbound_at IS NULL OR m.occurred_at > t.last_outbound_at)
            ) AS unread_inbound_count
     FROM outreach_threads t
     WHERE t.user_id = $1
       ${scopePredicate}
       AND (
         $2::timestamptz IS NULL
         OR t.updated_at < $2
         OR (t.updated_at = $2 AND t.id < $3)
       )
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT $4`,
    [userId, decoded?.updatedAt ?? null, decoded?.id ?? null, limit + 1],
  );

  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  return {
    data: visible.map(toThreadSummary),
    nextCursor: hasMore && visible.length > 0 ? encodeCursor(visible[visible.length - 1]!) : null,
  };
}

export async function findMessagesByThreadId(threadId: number): Promise<OutreachMessageRow[]> {
  const rows = await query<OutreachMessageDbRow>(
    `SELECT * FROM outreach_messages
     WHERE thread_id = $1
     ORDER BY occurred_at ASC, id ASC`,
    [threadId],
  );
  return rows.map(toMessageRow);
}

export async function findEventsByThreadId(threadId: number): Promise<OutreachEventRow[]> {
  const rows = await query<OutreachEventDbRow>(
    `SELECT * FROM outreach_events
     WHERE thread_id = $1
     ORDER BY occurred_at ASC, id ASC`,
    [threadId],
  );
  return rows.map(toEventRow);
}

export async function findAttachmentsByMessageIds(
  messageIds: number[],
): Promise<Map<number, AttachmentRow[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await query<AttachmentRow>(
    `SELECT omd.message_id, omd.document_id, ld.label, ld.status
     FROM outreach_message_documents omd
     JOIN listing_documents ld ON ld.id = omd.document_id
     WHERE omd.message_id = ANY($1::bigint[])`,
    [messageIds],
  );
  const map = new Map<number, AttachmentRow[]>();
  for (const row of rows) {
    const id = Number(row.message_id);
    const bucket = map.get(id) ?? [];
    bucket.push(row);
    map.set(id, bucket);
  }
  return map;
}

export async function findMessageById(id: number): Promise<OutreachMessageRow | null> {
  const rows = await query<OutreachMessageDbRow>('SELECT * FROM outreach_messages WHERE id = $1', [
    id,
  ]);
  return rows[0] ? toMessageRow(rows[0]) : null;
}

export async function findOutboundMessageByKind(
  threadId: number,
  kind: 'initial' | 'followup',
): Promise<OutreachMessageRow | null> {
  const rows = await query<OutreachMessageDbRow>(
    `SELECT * FROM outreach_messages
     WHERE thread_id = $1 AND direction = 'outbound' AND message_kind = $2
     ORDER BY id DESC
     LIMIT 1`,
    [threadId, kind],
  );
  return rows[0] ? toMessageRow(rows[0]) : null;
}

export async function createOrReuseFollowupDraft(input: {
  threadId: number;
  mailboxAccountId: number;
  subject: string;
  bodyText: string;
  fromEmail: string;
  toEmail: string;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
}): Promise<OutreachMessageRow> {
  const existing = await findOutboundMessageByKind(input.threadId, 'followup');
  if (existing) return existing;
  const rows = await query<OutreachMessageDbRow>(
    `INSERT INTO outreach_messages (
       thread_id, mailbox_account_id, direction, message_kind, delivery_status,
       subject, body_text, from_email, to_email, in_reply_to, references_header, match_strategy
     ) VALUES ($1, $2, 'outbound', 'followup', 'draft', $3, $4, $5, $6, $7, $8, 'manual')
     RETURNING *`,
    [
      input.threadId,
      input.mailboxAccountId,
      input.subject,
      input.bodyText,
      input.fromEmail,
      input.toEmail,
      input.inReplyTo ?? null,
      input.referencesHeader ?? null,
    ],
  );
  return toMessageRow(rows[0]!);
}

export async function updateMessageStatus(input: {
  id: number;
  deliveryStatus: 'draft' | 'queued' | 'sent' | 'received' | 'failed' | 'suppressed';
  providerMessageId?: string | null;
  errorMessage?: string | null;
  occurredAt?: Date;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  threadId?: number | null;
}): Promise<OutreachMessageRow | null> {
  const rows = await query<OutreachMessageDbRow>(
    `UPDATE outreach_messages
     SET delivery_status = $2,
         provider_message_id = COALESCE($3, provider_message_id),
         error_message = $4,
         occurred_at = COALESCE($5, occurred_at),
         in_reply_to = COALESCE($6, in_reply_to),
         references_header = COALESCE($7, references_header),
         thread_id = COALESCE($8, thread_id),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      input.id,
      input.deliveryStatus,
      input.providerMessageId ?? null,
      input.errorMessage ?? null,
      input.occurredAt ?? null,
      input.inReplyTo ?? null,
      input.referencesHeader ?? null,
      input.threadId ?? null,
    ],
  );
  return rows[0] ? toMessageRow(rows[0]) : null;
}

export async function insertInboundMessage(input: {
  mailboxAccountId: number;
  threadId?: number | null;
  providerMessageId?: string | null;
  imapUid?: number | null;
  imapUidvalidity?: number | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  subject: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
  fromEmail?: string | null;
  toEmail?: string | null;
  matchStrategy: OutreachMatchStrategy;
  storageKey?: string | null;
  checksum?: string | null;
  occurredAt?: Date;
  errorMessage?: string | null;
}): Promise<OutreachMessageRow> {
  const rows = await query<OutreachMessageDbRow>(
    `INSERT INTO outreach_messages (
       thread_id, mailbox_account_id, direction, message_kind, delivery_status,
       provider_message_id, imap_uid, imap_uidvalidity,
       in_reply_to, references_header, subject, body_text, body_html,
       from_email, to_email, match_strategy, storage_key, checksum, occurred_at, error_message
     ) VALUES (
       $1, $2, 'inbound', 'reply', 'received',
       $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, COALESCE($16, NOW()), $17
     )
     ON CONFLICT (mailbox_account_id, provider_message_id)
       WHERE provider_message_id IS NOT NULL
     DO UPDATE SET
       updated_at = NOW(),
       thread_id = COALESCE(EXCLUDED.thread_id, outreach_messages.thread_id),
       error_message = EXCLUDED.error_message
     RETURNING *`,
    [
      input.threadId ?? null,
      input.mailboxAccountId,
      input.providerMessageId ?? null,
      input.imapUid ?? null,
      input.imapUidvalidity ?? null,
      input.inReplyTo ?? null,
      input.referencesHeader ?? null,
      input.subject,
      input.bodyText ?? null,
      input.bodyHtml ?? null,
      input.fromEmail ?? null,
      input.toEmail ?? null,
      input.matchStrategy,
      input.storageKey ?? null,
      input.checksum ?? null,
      input.occurredAt ?? null,
      input.errorMessage ?? null,
    ],
  );
  return toMessageRow(rows[0]!);
}

export async function findThreadByProviderMessageIds(
  providerMessageIds: string[],
): Promise<OutreachThreadRow | null> {
  if (providerMessageIds.length === 0) return null;
  const rows = await query<OutreachThreadDbRow>(
    `SELECT t.*
     FROM outreach_messages m
     JOIN outreach_threads t ON t.id = m.thread_id
     WHERE m.provider_message_id = ANY($1::text[])
       AND m.thread_id IS NOT NULL
     ORDER BY m.occurred_at DESC, m.id DESC
     LIMIT 1`,
    [providerMessageIds],
  );
  return rows[0] ? toThreadRow(rows[0]) : null;
}

export async function findOpenThreadCandidatesByContact(
  userId: number,
  contactEmail: string,
  limit = 10,
): Promise<Array<{ thread: OutreachThreadRow; latestSubject: string | null }>> {
  const rows = await query<OutreachThreadDbRow & { latest_subject: string | null }>(
    `SELECT t.*,
            (
              SELECT m.subject FROM outreach_messages m
              WHERE m.thread_id = t.id
              ORDER BY m.occurred_at DESC, m.id DESC
              LIMIT 1
            ) AS latest_subject
     FROM outreach_threads t
     WHERE t.user_id = $1
       AND t.contact_email = $2
       AND t.workflow_state <> 'closed'
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT $3`,
    [userId, contactEmail, limit],
  );
  return rows.map((row) => ({ thread: toThreadRow(row), latestSubject: row.latest_subject }));
}

export async function linkDocumentToMessage(messageId: number, documentId: number): Promise<void> {
  await query(
    `INSERT INTO outreach_message_documents (message_id, document_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [messageId, documentId],
  );
}
