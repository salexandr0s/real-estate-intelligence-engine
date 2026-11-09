import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Worker } from 'bullmq';
import type { ConnectionOptions, Job, Queue } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { loadConfig } from '@immoradar/config';
import type { OutreachWorkflowState } from '@immoradar/contracts';
import { documents, mailboxes, outreach } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import {
  applyOutreachTransition,
  extractMessageIds,
  normalizeMessageId,
  normalizeThreadSubject,
  stripQuotedReplyText,
} from '@immoradar/outreach';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  createQueue,
  getQueuePrefix,
  getRedisConnection,
} from '@immoradar/scraper-core';
import type { DocumentProcessingJobData, MailboxSyncJobData } from '@immoradar/scraper-core';

const log = createLogger('worker:mailbox-sync');

type DocumentQueue = Pick<Queue<DocumentProcessingJobData>, 'add'>;
type ParsedMailLike = Awaited<ReturnType<typeof simpleParser>>;
type MailboxClientLike = {
  mailbox?: { uidValidity?: bigint } | false;
  connect(): Promise<void>;
  getMailboxLock(mailbox: string, options: { readOnly: boolean }): Promise<{ release(): void }>;
  search(search: Record<string, unknown>, options: { uid: true }): Promise<number[]>;
  fetch(
    ids: number[],
    query: { uid: true; source: true; envelope: true; internalDate: true },
    options: { uid: true },
  ): AsyncIterable<{
    uid?: number;
    source?: Buffer;
    envelope?: { subject?: string | null };
    internalDate?: Date;
  }>;
  logout(): Promise<void>;
};

type MailboxSyncResult =
  | { status: 'skipped'; reason: 'missing_mailbox' }
  | { status: 'completed'; processedCount: number; unmatchedCount: number; maxUid: number };

let documentQueue: DocumentQueue | null = null;

function getDocumentQueue(): DocumentQueue {
  if (!documentQueue) {
    documentQueue = createQueue<DocumentProcessingJobData>(QUEUE_NAMES.DOCUMENT_PROCESSING);
  }
  return documentQueue;
}

function firstAddress(address?: { value?: Array<{ address?: string }> }): string | null {
  return address?.value?.[0]?.address?.trim().toLowerCase() ?? null;
}

async function defaultStoreBuffer(
  prefix: string,
  extension: string,
  buffer: Buffer,
): Promise<string> {
  const config = loadConfig();
  const now = new Date();
  const storageKey = `${prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(
    now.getUTCDate(),
  ).padStart(2, '0')}/${randomUUID()}.${extension}`;
  const fullPath = join(config.artifacts.dir, storageKey);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
  return storageKey;
}

/**
 * The state a reply moves a thread to, given the state the thread is in when the reply is
 * stored. A closed thread stays as it is.
 */
function replyState(current: OutreachWorkflowState): OutreachWorkflowState | null {
  return current === 'closed' ? null : applyOutreachTransition(current, { type: 'REPLY_RECEIVED' });
}

async function matchThread(
  mailboxUserId: number,
  fromEmail: string | null,
  normalizedSubject: string,
  headerIds: string[],
) {
  if (headerIds.length > 0) {
    const byHeaders = await outreach.findThreadByProviderMessageIds(mailboxUserId, headerIds);
    if (byHeaders) {
      return { thread: byHeaders, strategy: 'headers' as const };
    }
  }

  if (fromEmail) {
    const candidates = await outreach.findOpenThreadCandidatesByContact(mailboxUserId, fromEmail);
    const matched = candidates.filter(
      (candidate) => normalizeThreadSubject(candidate.latestSubject) === normalizedSubject,
    );
    if (matched.length === 1) {
      return { thread: matched[0]!.thread, strategy: 'from_subject' as const };
    }
  }

  return { thread: null, strategy: 'unmatched' as const };
}

export async function processMailboxSyncJob(
  jobData: MailboxSyncJobData,
  deps: {
    config?: ReturnType<typeof loadConfig>;
    clientFactory?: () => MailboxClientLike;
    parser?: (input: Buffer) => Promise<ParsedMailLike>;
    storeBuffer?: (prefix: string, extension: string, buffer: Buffer) => Promise<string>;
    documentQueue?: DocumentQueue;
    now?: () => Date;
  } = {},
): Promise<MailboxSyncResult> {
  const config = deps.config ?? loadConfig();
  const mailbox = await mailboxes.findById(jobData.mailboxAccountId);
  if (!mailbox || !mailbox.isActive) {
    log.warn('Mailbox not found or inactive, skipping sync', {
      mailboxAccountId: jobData.mailboxAccountId,
    });
    return { status: 'skipped', reason: 'missing_mailbox' };
  }

  await mailboxes.markSyncStarted(mailbox.id);
  const client: MailboxClientLike =
    deps.clientFactory?.() ??
    (new ImapFlow({
      host: config.outreach.imap.host,
      port: config.outreach.imap.port,
      secure: config.outreach.imap.secure,
      auth: {
        user: config.outreach.imap.user,
        pass: config.outreach.imap.password,
      },
      disableAutoIdle: true,
      logger: false,
    }) as unknown as MailboxClientLike);
  const parseMail = deps.parser ?? simpleParser;
  const storeBuffer = deps.storeBuffer ?? defaultStoreBuffer;
  const docQueue = deps.documentQueue ?? getDocumentQueue();

  // The cursor is the highest UID fully handled under `uidValidity`. It only moves after a
  // message is stored, so a failed sync picks up at the message that failed.
  let uidValidity = mailbox.lastSeenUidvalidity;
  let cursor = mailbox.lastSeenUid;
  let maxUid = cursor ?? 0;
  let unmatchedCount = 0;
  let processedCount = 0;
  const savedCursor = () => ({
    lastSeenUid: maxUid > 0 ? maxUid : cursor,
    lastSeenUidvalidity: uidValidity,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.outreach.imap.mailbox, { readOnly: true });
    try {
      const mailboxState = client.mailbox as { uidValidity?: bigint } | false | undefined;
      const currentUidValidity =
        mailboxState && typeof mailboxState === 'object'
          ? Number(mailboxState.uidValidity ?? 0n)
          : 0;
      if (currentUidValidity > 0 && currentUidValidity !== uidValidity) {
        if (uidValidity != null) {
          // The server renumbered the mailbox, so stored UIDs point at other messages.
          log.warn('Mailbox UIDVALIDITY changed, rescanning the lookback window', {
            mailboxAccountId: mailbox.id,
            previous: uidValidity,
            current: currentUidValidity,
          });
          cursor = null;
          maxUid = 0;
        }
        uidValidity = currentUidValidity;
      }

      const search =
        cursor != null
          ? { uid: `${cursor + 1}:*` }
          : {
              since: new Date(
                (deps.now?.() ?? new Date()).getTime() -
                  config.outreach.initialLookbackDays * 24 * 60 * 60 * 1000,
              ),
            };
      // `UID n:*` always includes the newest message, even when n is past it (RFC 3501), so
      // without this filter every sync handled the last message again.
      const sinceCursor = cursor;
      const ids = ((await client.search(search, { uid: true })) || []).filter(
        (uid) => sinceCursor == null || uid > sinceCursor,
      );

      const fetched =
        ids.length > 0
          ? client.fetch(
              ids,
              { uid: true, source: true, envelope: true, internalDate: true },
              { uid: true },
            )
          : [];
      for await (const item of fetched) {
        const uid = item.uid ?? 0;
        const rawSource = item.source;
        if ((sinceCursor != null && uid <= sinceCursor) || !rawSource) continue;

        const parsed = await parseMail(rawSource);
        const providerMessageId = normalizeMessageId(
          parsed.messageId ?? `uid:${uidValidity ?? 0}:${uid}`,
        );

        // Mail seen before (after a cursor reset, or our own sent copy) is handled once.
        if (await outreach.findMessageByProviderId(mailbox.id, providerMessageId)) {
          log.debug('Inbound message already recorded, skipping', {
            mailboxAccountId: mailbox.id,
            uid,
            providerMessageId,
          });
          if (uid > maxUid) maxUid = uid;
          continue;
        }

        const headerIds = [
          ...extractMessageIds(parsed.inReplyTo),
          ...extractMessageIds(parsed.references),
        ].filter((id, index, all) => all.indexOf(id) === index);
        const normalizedSubject = normalizeThreadSubject(
          parsed.subject ?? item.envelope?.subject ?? '',
        );
        const fromEmail = firstAddress(parsed.from);
        const toEmail = firstAddress(parsed.to);
        const rawStorageKey = await storeBuffer('mail/raw', 'eml', rawSource);
        const checksum = createHash('sha256').update(rawSource).digest('hex');

        const match = await matchThread(mailbox.userId, fromEmail, normalizedSubject, headerIds);
        const { message, inserted } = await outreach.recordInboundMessage(
          {
            mailboxAccountId: mailbox.id,
            threadId: match.thread?.id ?? null,
            providerMessageId,
            imapUid: uid,
            imapUidvalidity: uidValidity,
            inReplyTo: headerIds[0] ?? null,
            referencesHeader: headerIds.length > 0 ? headerIds.join(' ') : null,
            subject: parsed.subject ?? item.envelope?.subject ?? '(no subject)',
            bodyText: stripQuotedReplyText(parsed.text ?? null),
            bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
            fromEmail,
            toEmail,
            matchStrategy: match.strategy,
            storageKey: rawStorageKey,
            checksum,
            occurredAt:
              parsed.date ??
              (item.internalDate instanceof Date
                ? item.internalDate
                : (deps.now?.() ?? new Date())),
            errorMessage: match.thread ? null : 'thread_unmatched',
          },
          match.thread ? replyState : null,
        );
        if (!inserted) {
          // A concurrent sync stored it first and handled the rest.
          if (uid > maxUid) maxUid = uid;
          continue;
        }

        processedCount += 1;
        if (!match.thread) {
          unmatchedCount += 1;
          if (uid > maxUid) maxUid = uid;
          continue;
        }

        for (const attachment of parsed.attachments) {
          if (attachment.contentType !== 'application/pdf') {
            continue;
          }
          const attachmentChecksum = createHash('sha256').update(attachment.content).digest('hex');
          const extension = (attachment.filename?.split('.').pop() || 'pdf').toLowerCase();
          const attachmentStorageKey = await storeBuffer(
            'mail/attachments',
            extension,
            attachment.content,
          );
          const document = await documents.upsertDocument({
            listingId: match.thread.listingId,
            url: `email-attachment://${providerMessageId}/${attachment.filename ?? 'attachment.pdf'}`,
            checksum: attachmentChecksum,
            mimeType: attachment.contentType,
            sizeBytes: attachment.content.length,
            storageKey: attachmentStorageKey,
            documentType: 'email_attachment',
            label: attachment.filename ?? 'Email attachment',
            status: 'downloaded',
          });
          await outreach.linkDocumentToMessage(message.id, document.id);
          await docQueue.add(
            `document:${document.id}:${Date.now()}`,
            { documentId: document.id },
            { jobId: `document-${document.id}-${Date.now()}` },
          );
        }
        if (uid > maxUid) maxUid = uid;
      }

      await mailboxes.markSyncFinished(mailbox.id, {
        status: unmatchedCount > 0 ? 'degraded' : 'healthy',
        ...savedCursor(),
        errorMessage: unmatchedCount > 0 ? `${unmatchedCount} unmatched inbound messages` : null,
      });
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (error) {
    await mailboxes.markSyncFinished(mailbox.id, {
      status: 'failed',
      ...savedCursor(),
      errorCode: 'mailbox_sync_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return { status: 'completed', processedCount, unmatchedCount, maxUid };
}

export function createMailboxSyncWorker(): Worker<MailboxSyncJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  return new Worker<MailboxSyncJobData>(
    QUEUE_NAMES.MAILBOX_SYNC,
    async (job: Job<MailboxSyncJobData>) => processMailboxSyncJob(job.data),
    {
      connection,
      prefix,
      concurrency: WORKER_CONCURRENCY,
    },
  );
}
