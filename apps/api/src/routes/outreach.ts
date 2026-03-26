import type { FastifyInstance } from 'fastify';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import { listings, mailboxes, outreach } from '@immoradar/db';
import { ConflictError, NotFoundError, ValidationError } from '@immoradar/observability';
import { applyOutreachTransition } from '@immoradar/outreach';
import { QUEUE_NAMES, getQueuePrefix, getRedisConnection } from '@immoradar/scraper-core';
import type { OutreachSendJobData } from '@immoradar/scraper-core';
import {
  idParamSchema,
  manualFollowupSchema,
  outreachThreadActionSchema,
  outreachThreadListQuerySchema,
  parseOrThrow,
  startOutreachSchema,
} from '../schemas.js';

let outreachSendQueue: Queue<OutreachSendJobData> | null = null;

function getOutreachSendQueue(): Queue<OutreachSendJobData> {
  if (!outreachSendQueue) {
    outreachSendQueue = new Queue<OutreachSendJobData>(QUEUE_NAMES.OUTREACH_SEND, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
  }
  return outreachSendQueue;
}

async function ensureSharedMailboxForUser(userId: number) {
  const config = loadConfig();
  if (!config.outreach.enabled || !config.outreach.imap.user) {
    throw new ValidationError('Outreach is disabled or mailbox is not configured');
  }
  return mailboxes.ensureSharedMailbox({
    userId,
    email: config.outreach.imap.user,
    displayName: config.outreach.fromName || null,
    secretRef: 'env:OUTREACH_SHARED_MAILBOX',
    pollIntervalSeconds: config.outreach.pollIntervalSeconds,
  });
}

function queueSend(
  threadId: number,
  sendKind: 'initial' | 'followup',
  triggeredBy: 'api' | 'manual',
) {
  return getOutreachSendQueue().add(
    `outreach:${sendKind}:${threadId}:${Date.now()}`,
    { threadId, sendKind, triggeredBy },
    {
      jobId: `outreach:${sendKind}:${threadId}:${Date.now()}`,
    },
  );
}

export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/outreach/threads', async (request, reply) => {
    const parsed = parseOrThrow(outreachThreadListQuerySchema, request.query);
    const result = await outreach.findThreadsByUser(
      request.userId,
      parsed.scope,
      parsed.cursor ?? null,
      parsed.limit ?? 25,
    );
    return reply.send({ data: result.data, meta: { nextCursor: result.nextCursor } });
  });

  app.get<{ Params: { id: string } }>('/v1/outreach/threads/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const thread = await outreach.findThreadByIdForUser(id, request.userId);
    if (!thread) {
      throw new NotFoundError('Outreach thread', id);
    }

    const [messages, events] = await Promise.all([
      outreach.findMessagesByThreadId(thread.id),
      outreach.findEventsByThreadId(thread.id),
    ]);
    const attachments = await outreach.findAttachmentsByMessageIds(
      messages.map((message) => message.id),
    );
    const summary = await outreach.findSummaryForListing(request.userId, thread.listingId);

    return reply.send({
      data: {
        id: thread.id,
        listingId: thread.listingId,
        mailboxAccountId: thread.mailboxAccountId,
        contactName: thread.contactName,
        contactCompany: thread.contactCompany,
        contactEmail: thread.contactEmail,
        contactPhone: thread.contactPhone,
        workflowState: thread.workflowState,
        unreadInboundCount: summary?.threadId === thread.id ? summary.unreadInboundCount : 0,
        nextActionAt: thread.nextActionAt?.toISOString() ?? null,
        lastInboundAt: thread.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: thread.lastOutboundAt?.toISOString() ?? null,
        updatedAt: thread.updatedAt.toISOString(),
        messages: messages.map((message) => ({
          id: message.id,
          direction: message.direction,
          messageKind: message.messageKind,
          deliveryStatus: message.deliveryStatus,
          subject: message.subject,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          fromEmail: message.fromEmail,
          toEmail: message.toEmail,
          matchStrategy: message.matchStrategy,
          occurredAt: message.occurredAt.toISOString(),
          errorMessage: message.errorMessage,
          attachments: (attachments.get(message.id) ?? []).map((attachment) => ({
            documentId: Number(attachment.document_id),
            label: attachment.label,
            status: attachment.status,
          })),
        })),
        events: events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          fromState: event.fromState,
          toState: event.toState,
          payload: Object.fromEntries(
            Object.entries(event.payload ?? {}).map(([key, value]) => [key, String(value)]),
          ),
          occurredAt: event.occurredAt.toISOString(),
        })),
      },
      meta: {},
    });
  });

  app.post<{ Params: { id: string } }>(
    '/v1/listings/:id/outreach/start',
    async (request, reply) => {
      const config = loadConfig();
      if (!config.outreach.enabled) {
        throw new ValidationError('Outreach is disabled');
      }

      const { id } = parseOrThrow(idParamSchema, request.params);
      const body = parseOrThrow(startOutreachSchema, request.body);
      const listing = await listings.findById(id);
      if (!listing) {
        throw new NotFoundError('Listing', id);
      }

      const mailbox = await ensureSharedMailboxForUser(request.userId);
      const contactEmail = body.contactEmail ?? listing.contactEmail ?? null;
      if (!contactEmail) {
        throw new ValidationError('Listing has no contact email');
      }

      const existing = await outreach.findOpenThreadByListingContact(
        request.userId,
        listing.id,
        contactEmail,
      );
      if (existing) {
        throw new ConflictError(
          'An open outreach thread already exists for this listing and contact',
        );
      }

      const { thread, message } = await outreach.createThreadWithInitialDraft({
        userId: request.userId,
        listingId: listing.id,
        mailboxAccountId: mailbox.id,
        contactName: body.contactName ?? listing.contactName,
        contactCompany: body.contactCompany ?? listing.contactCompany,
        contactEmail,
        contactPhone: body.contactPhone ?? listing.contactPhone,
        subject: body.subject,
        bodyText: body.bodyText,
        fromEmail: mailbox.email,
      });

      await outreach.updateThreadState({
        threadId: thread.id,
        workflowState: 'queued_send',
        nextActionAt: null,
      });
      await outreach.updateMessageStatus({ id: message.id, deliveryStatus: 'queued' });
      await outreach.appendEvent({
        threadId: thread.id,
        messageId: message.id,
        eventType: 'queued_send',
        fromState: 'draft',
        toState: 'queued_send',
        payload: { sendKind: 'initial' },
      });
      await queueSend(thread.id, 'initial', 'api');

      return reply.code(201).send({ data: { threadId: thread.id }, meta: {} });
    },
  );

  app.patch<{ Params: { id: string } }>('/v1/outreach/threads/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const body = parseOrThrow(outreachThreadActionSchema, request.body);
    const thread = await outreach.findThreadByIdForUser(id, request.userId);
    if (!thread) {
      throw new NotFoundError('Outreach thread', id);
    }

    let nextState = thread.workflowState;
    switch (body.action) {
      case 'pause':
        nextState = applyOutreachTransition(thread.workflowState, { type: 'PAUSE' });
        break;
      case 'close':
        nextState = applyOutreachTransition(thread.workflowState, { type: 'CLOSE' });
        break;
      case 'retry':
        nextState = applyOutreachTransition(thread.workflowState, { type: 'RETRY' });
        break;
      case 'resume':
        nextState = applyOutreachTransition(thread.workflowState, {
          type: 'RESUME',
          hasSentInitial: thread.lastOutboundAt != null,
          followupStillPending:
            thread.lastOutboundAt != null &&
            thread.lastInboundAt == null &&
            thread.autoFollowupCount === 0,
        });
        break;
    }

    const updated = await outreach.updateThreadState({
      threadId: thread.id,
      workflowState: nextState,
      nextActionAt: body.action === 'pause' || body.action === 'close' ? null : thread.nextActionAt,
    });
    await outreach.appendEvent({
      threadId: thread.id,
      eventType: `thread_${body.action}`,
      fromState: thread.workflowState,
      toState: nextState,
      payload: {},
    });

    if (body.action === 'retry') {
      await queueSend(thread.id, thread.autoFollowupCount > 0 ? 'followup' : 'initial', 'manual');
    }
    if (body.action === 'resume' && nextState === 'queued_send') {
      await queueSend(thread.id, 'initial', 'manual');
    }

    return reply.send({ data: { workflowState: updated?.workflowState ?? nextState }, meta: {} });
  });

  app.post<{ Params: { id: string } }>(
    '/v1/outreach/threads/:id/follow-up',
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);
      const body = parseOrThrow(manualFollowupSchema, request.body ?? {});
      const thread = await outreach.findThreadByIdForUser(id, request.userId);
      if (!thread) {
        throw new NotFoundError('Outreach thread', id);
      }
      if (thread.lastInboundAt) {
        throw new ConflictError('Cannot send follow-up after a reply was received');
      }
      if (thread.autoFollowupCount > 0) {
        throw new ConflictError('Automatic follow-up has already been used');
      }

      const mailbox = await ensureSharedMailboxForUser(request.userId);
      const initial = await outreach.findOutboundMessageByKind(thread.id, 'initial');
      if (!initial) {
        throw new ValidationError('Initial outbound message not found');
      }

      await outreach.createOrReuseFollowupDraft({
        threadId: thread.id,
        mailboxAccountId: mailbox.id,
        subject: body.subject ?? `Re: ${initial.subject}`,
        bodyText:
          body.bodyText ??
          'Ich wollte höflich nachfassen und fragen, ob die Immobilie noch verfügbar ist.',
        fromEmail: mailbox.email,
        toEmail: thread.contactEmail,
        inReplyTo: initial.providerMessageId,
        referencesHeader: initial.providerMessageId,
      });
      await outreach.updateThreadState({
        threadId: thread.id,
        workflowState: 'queued_send',
        nextActionAt: null,
      });
      await outreach.appendEvent({
        threadId: thread.id,
        eventType: 'followup_queued',
        fromState: thread.workflowState,
        toState: 'queued_send',
        payload: { manual: true },
      });
      await queueSend(thread.id, 'followup', 'manual');

      return reply.send({ data: { accepted: true }, meta: {} });
    },
  );
}
