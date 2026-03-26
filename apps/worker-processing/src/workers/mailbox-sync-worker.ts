import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { loadConfig } from '@immoradar/config';
import { documents, mailboxes, outreach } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import {
  applyOutreachTransition,
  normalizeThreadSubject,
  stripQuotedReplyText,
} from '@immoradar/outreach';
import { QUEUE_NAMES, getQueuePrefix, getRedisConnection } from '@immoradar/scraper-core';
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
    documentQueue = new Queue<DocumentProcessingJobData>(QUEUE_NAMES.DOCUMENT_PROCESSING, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
  }
  return documentQueue;
}

function normalizeMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, '');
}

function collectReferenceIds(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : value.split(/\s+/);
  return raw.map((entry) => normalizeMessageId(entry)).filter(Boolean);
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
  const fullPath = join(config.s3.bucket, storageKey);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
  return storageKey;
}

async function matchThread(
  mailboxUserId: number,
  fromEmail: string | null,
  normalizedSubject: string,
  headerIds: string[],
) {
  if (headerIds.length > 0) {
    const byHeaders = await outreach.findThreadByProviderMessageIds(headerIds);
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

  let maxUid = mailbox.lastSeenUid ?? 0;
  let unmatchedCount = 0;
  let processedCount = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.outreach.imap.mailbox, { readOnly: true });
    try {
      const mailboxState = client.mailbox as { uidValidity?: bigint } | false | undefined;
      let currentUidValidity = 0;
      if (mailboxState && typeof mailboxState === 'object') {
        currentUidValidity = Number(mailboxState.uidValidity ?? 0n);
      }
      const search =
        mailbox.lastSeenUid != null
          ? { uid: `${mailbox.lastSeenUid + 1}:*` }
          : {
              since: new Date(
                (deps.now?.() ?? new Date()).getTime() -
                  config.outreach.initialLookbackDays * 24 * 60 * 60 * 1000,
              ),
            };
      const ids = (await client.search(search, { uid: true })) || [];

      for await (const fetched of client.fetch(
        ids,
        { uid: true, source: true, envelope: true, internalDate: true },
        { uid: true },
      )) {
        const uid = fetched.uid ?? 0;
        if (uid > maxUid) maxUid = uid;
        const rawSource = fetched.source;
        if (!rawSource) continue;

        processedCount += 1;
        const parsed = await parseMail(rawSource);
        const providerMessageId = normalizeMessageId(
          parsed.messageId ?? `uid:${currentUidValidity}:${uid}`,
        );
        const headerIds = [
          ...collectReferenceIds(parsed.inReplyTo),
          ...collectReferenceIds(parsed.references),
        ];
        const normalizedSubject = normalizeThreadSubject(
          parsed.subject ?? fetched.envelope?.subject ?? '',
        );
        const fromEmail = firstAddress(parsed.from);
        const toEmail = firstAddress(parsed.to);
        const rawStorageKey = await storeBuffer('mail/raw', 'eml', rawSource);
        const checksum = createHash('sha256').update(rawSource).digest('hex');

        const match = await matchThread(mailbox.userId, fromEmail, normalizedSubject, headerIds);
        const message = await outreach.insertInboundMessage({
          mailboxAccountId: mailbox.id,
          threadId: match.thread?.id ?? null,
          providerMessageId,
          imapUid: uid,
          imapUidvalidity: currentUidValidity,
          inReplyTo: headerIds[0] ?? null,
          referencesHeader: headerIds.length > 0 ? headerIds.join(' ') : null,
          subject: parsed.subject ?? fetched.envelope?.subject ?? '(no subject)',
          bodyText: stripQuotedReplyText(parsed.text ?? null),
          bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
          fromEmail,
          toEmail,
          matchStrategy: match.strategy,
          storageKey: rawStorageKey,
          checksum,
          occurredAt:
            parsed.date ??
            (fetched.internalDate instanceof Date
              ? fetched.internalDate
              : (deps.now?.() ?? new Date())),
          errorMessage: match.thread ? null : 'thread_unmatched',
        });

        if (!match.thread) {
          unmatchedCount += 1;
          continue;
        }

        if (match.thread.workflowState !== 'closed') {
          const nextState = applyOutreachTransition(match.thread.workflowState, {
            type: 'REPLY_RECEIVED',
          });
          await outreach.updateThreadState({
            threadId: match.thread.id,
            workflowState: nextState,
            lastInboundAt: message.occurredAt,
            nextActionAt: null,
          });
          await outreach.appendEvent({
            threadId: match.thread.id,
            messageId: message.id,
            eventType: 'reply_received',
            fromState: match.thread.workflowState,
            toState: nextState,
            payload: { matchStrategy: match.strategy },
          });
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
            { jobId: `document:${document.id}:${Date.now()}` },
          );
        }
      }

      await mailboxes.markSyncFinished(mailbox.id, {
        status: unmatchedCount > 0 ? 'degraded' : 'healthy',
        lastSeenUid: maxUid > 0 ? maxUid : mailbox.lastSeenUid,
        lastSeenUidvalidity: currentUidValidity,
        errorMessage: unmatchedCount > 0 ? `${unmatchedCount} unmatched inbound messages` : null,
      });
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (error) {
    await mailboxes.markSyncFinished(mailbox.id, {
      status: 'failed',
      lastSeenUid: maxUid > 0 ? maxUid : mailbox.lastSeenUid,
      lastSeenUidvalidity: mailbox.lastSeenUidvalidity,
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
      concurrency: 1,
    },
  );
}
