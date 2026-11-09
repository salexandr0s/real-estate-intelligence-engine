import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import type { OutreachThreadRow, OutreachWorkflowState } from '@immoradar/contracts';
import { listings, mailboxes, outreach } from '@immoradar/db';
import {
  ConflictError,
  NotFoundError,
  TransientError,
  ValidationError,
  createLogger,
} from '@immoradar/observability';
import { applyOutreachTransition } from '@immoradar/outreach';
import { QUEUE_NAMES, createQueue } from '@immoradar/scraper-core';
import type { OutreachSendJobData } from '@immoradar/scraper-core';
import {
  idParamSchema,
  manualFollowupSchema,
  outreachThreadActionSchema,
  outreachThreadListQuerySchema,
  parseOrThrow,
  startOutreachSchema,
} from '../schemas.js';

const log = createLogger('api:outreach');

type SendKind = OutreachSendJobData['sendKind'];

const THREAD_CHANGED = 'The thread changed in the meantime. Reload it and try again';

// A manual follow-up goes out only while the thread waits for a reply.
const MANUAL_FOLLOWUP_STATES: OutreachWorkflowState[] = ['sent_waiting_reply', 'followup_due'];
const MANUAL_FOLLOWUP_REFUSALS: Record<
  Exclude<OutreachWorkflowState, 'sent_waiting_reply' | 'followup_due'>,
  string
> = {
  draft: 'The initial email has not been sent yet',
  queued_send: 'A send is already queued for this thread',
  reply_received: 'A reply was already received',
  followup_sent: 'A follow-up was already sent',
  paused: 'The thread is paused. Resume it first',
  closed: 'The thread is closed',
  failed: 'The last send failed. Retry it instead',
};

let outreachSendQueue: Queue<OutreachSendJobData> | null = null;

function getOutreachSendQueue(): Queue<OutreachSendJobData> {
  if (!outreachSendQueue) {
    outreachSendQueue = createQueue<OutreachSendJobData>(QUEUE_NAMES.OUTREACH_SEND);
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function queueSend(threadId: number, sendKind: SendKind, triggeredBy: 'api' | 'manual') {
  return getOutreachSendQueue().add(
    `outreach:${sendKind}:${threadId}:${Date.now()}`,
    { threadId, sendKind, triggeredBy },
    {
      jobId: `outreach-${sendKind}-${threadId}-${Date.now()}`,
    },
  );
}

/**
 * Adds the send job after the queued state is committed, so the worker always finds the
 * thread queued. When the add fails, `revert` (if any) puts the thread in a state the user can
 * act on and the request fails with 503 instead of leaving a send that will never run.
 */
async function enqueueSend(
  threadId: number,
  sendKind: SendKind,
  triggeredBy: 'api' | 'manual',
  revert: (() => Promise<unknown>) | null,
  failureMessage: string,
): Promise<void> {
  try {
    await queueSend(threadId, sendKind, triggeredBy);
  } catch (error) {
    log.error('Could not queue outreach send', { threadId, sendKind, error: errorText(error) });
    try {
      await revert?.();
    } catch (revertError) {
      log.error('Could not restore the thread after a failed enqueue', {
        threadId,
        error: errorText(revertError),
      });
    }
    throw new TransientError(failureMessage, 'outreach_enqueue_failed');
  }
}

/** Puts a thread back to the state it had before it was queued. */
function restoreState(thread: OutreachThreadRow, sendKind: SendKind, messageId?: number) {
  return () =>
    outreach.transitionThreadState({
      threadId: thread.id,
      from: ['queued_send'],
      to: thread.workflowState,
      nextActionAt: thread.nextActionAt,
      event: { messageId, eventType: 'send_enqueue_failed', payload: { sendKind } },
    });
}

/** A retry sends what didn't go out: the initial email, or else the follow-up. */
async function retrySendKind(threadId: number): Promise<SendKind> {
  const initial = await outreach.findOutboundMessageByKind(threadId, 'initial');
  return initial?.deliveryStatus === 'sent' ? 'followup' : 'initial';
}

function manualFollowupRefusal(thread: OutreachThreadRow): string | null {
  if (thread.lastInboundAt) return MANUAL_FOLLOWUP_REFUSALS.reply_received;
  if (thread.autoFollowupCount > 0) return MANUAL_FOLLOWUP_REFUSALS.followup_sent;
  const state = thread.workflowState;
  if (state === 'sent_waiting_reply' || state === 'followup_due') return null;
  return MANUAL_FOLLOWUP_REFUSALS[state];
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

      const { thread, message } = await outreach.createThreadWithQueuedInitial({
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
      await enqueueSend(
        thread.id,
        'initial',
        'api',
        () =>
          outreach.failQueuedSend({
            threadId: thread.id,
            messageId: message.id,
            errorMessage: 'Could not queue the send job',
          }),
        'Could not queue the email. The thread is marked failed; retry it from there',
      );

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

    if (body.action === 'retry' && nextState !== 'queued_send') {
      throw new ConflictError(`Nothing to retry: the thread is ${thread.workflowState}`);
    }

    if (body.action === 'retry' && thread.workflowState === 'queued_send') {
      // Queued, but the job may be gone: lost with Redis, or the worker stopped between the
      // state change and the send. Queue it again; the worker skips an email it already sent.
      await enqueueSend(
        thread.id,
        await retrySendKind(thread.id),
        'manual',
        null,
        'Could not queue the email. Try again in a moment',
      );
      return reply.send({ data: { workflowState: thread.workflowState }, meta: {} });
    }

    if (nextState === 'queued_send' && thread.workflowState !== 'queued_send') {
      // Resume only queues the initial email; the worker won't send one twice.
      const sendKind = body.action === 'retry' ? await retrySendKind(thread.id) : 'initial';
      const queued = await outreach.transitionThreadState({
        threadId: thread.id,
        from: [thread.workflowState],
        to: 'queued_send',
        nextActionAt: null,
        event: { eventType: `thread_${body.action}`, payload: { sendKind } },
      });
      if (!queued) {
        throw new ConflictError(THREAD_CHANGED);
      }
      await enqueueSend(
        thread.id,
        sendKind,
        'manual',
        restoreState(thread, sendKind),
        'Could not queue the email. Try again in a moment',
      );
      return reply.send({ data: { workflowState: queued.workflowState }, meta: {} });
    }

    // Only from the state the action was computed from, so a reply or send that landed since
    // the read above isn't overwritten.
    const updated = await outreach.transitionThreadState({
      threadId: thread.id,
      from: [thread.workflowState],
      to: nextState,
      nextActionAt: body.action === 'pause' || body.action === 'close' ? null : thread.nextActionAt,
      event: { eventType: `thread_${body.action}` },
    });
    if (!updated) {
      throw new ConflictError(THREAD_CHANGED);
    }

    return reply.send({ data: { workflowState: updated.workflowState }, meta: {} });
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
      const refusal = manualFollowupRefusal(thread);
      if (refusal) {
        throw new ConflictError(refusal);
      }

      const mailbox = await ensureSharedMailboxForUser(request.userId);
      const initial = await outreach.findOutboundMessageByKind(thread.id, 'initial');
      if (initial?.deliveryStatus !== 'sent') {
        throw new ConflictError(MANUAL_FOLLOWUP_REFUSALS.draft);
      }

      const draft = await outreach.createOrReuseFollowupDraft({
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
      // Only one request can move the thread out of a waiting state, so a second follow-up
      // can't be queued while the first one is pending.
      const queued = await outreach.transitionThreadState({
        threadId: thread.id,
        from: MANUAL_FOLLOWUP_STATES,
        to: 'queued_send',
        nextActionAt: null,
        event: { messageId: draft.id, eventType: 'followup_queued', payload: { manual: true } },
      });
      if (!queued) {
        throw new ConflictError(THREAD_CHANGED);
      }
      await enqueueSend(
        thread.id,
        'followup',
        'manual',
        restoreState(thread, 'followup', draft.id),
        'Could not queue the follow-up. Try again in a moment',
      );

      return reply.send({ data: { accepted: true }, meta: {} });
    },
  );
}
