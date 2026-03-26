import type { FastifyInstance } from 'fastify';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import { NotFoundError, ValidationError } from '@immoradar/observability';
import { mailboxes } from '@immoradar/db';
import { QUEUE_NAMES, getQueuePrefix, getRedisConnection } from '@immoradar/scraper-core';
import type { MailboxSyncJobData } from '@immoradar/scraper-core';
import { idParamSchema, parseOrThrow } from '../schemas.js';

let mailboxSyncQueue: Queue<MailboxSyncJobData> | null = null;

function getMailboxSyncQueue(): Queue<MailboxSyncJobData> {
  if (!mailboxSyncQueue) {
    mailboxSyncQueue = new Queue<MailboxSyncJobData>(QUEUE_NAMES.MAILBOX_SYNC, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
  }
  return mailboxSyncQueue;
}

async function ensureSharedMailboxForUser(userId: number) {
  const config = loadConfig();
  if (!config.outreach.enabled || !config.outreach.imap.user) {
    return null;
  }
  return mailboxes.ensureSharedMailbox({
    userId,
    email: config.outreach.imap.user,
    displayName: config.outreach.fromName || null,
    secretRef: 'env:OUTREACH_SHARED_MAILBOX',
    pollIntervalSeconds: config.outreach.pollIntervalSeconds,
  });
}

export async function mailboxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/mailboxes', async (request, reply) => {
    await ensureSharedMailboxForUser(request.userId);
    const rows = await mailboxes.findByUser(request.userId);
    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        syncStatus: row.syncStatus,
        pollIntervalSeconds: row.pollIntervalSeconds,
        lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
        lastErrorMessage: row.lastErrorMessage,
      })),
      meta: {},
    });
  });

  app.post<{ Params: { id: string } }>('/v1/mailboxes/:id/sync', async (request, reply) => {
    const config = loadConfig();
    if (!config.outreach.enabled) {
      throw new ValidationError('Outreach is disabled');
    }

    const { id } = parseOrThrow(idParamSchema, request.params);
    const mailbox = await mailboxes.findByIdForUser(id, request.userId);
    if (!mailbox) {
      throw new NotFoundError('Mailbox', id);
    }

    const queue = getMailboxSyncQueue();
    await queue.add(
      `mailbox-sync:${mailbox.id}:${Date.now()}`,
      { mailboxAccountId: mailbox.id, triggeredBy: 'manual' },
      { jobId: `mailbox-sync:manual:${mailbox.id}:${Date.now()}` },
    );

    return reply.send({ data: { accepted: true }, meta: {} });
  });
}
