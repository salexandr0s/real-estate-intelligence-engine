import nodemailer, { type Transporter } from 'nodemailer';
import { Worker } from 'bullmq';
import type { ConnectionOptions, Job, Queue } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import { mailboxes, outreach } from '@immoradar/db';
import type { OutreachMessageRow } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';
import { applyOutreachTransition, normalizeMessageId } from '@immoradar/outreach';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  createQueue,
  getQueuePrefix,
  getRedisConnection,
} from '@immoradar/scraper-core';
import type { OutreachSendJobData } from '@immoradar/scraper-core';

const log = createLogger('worker:outreach-send');

type MailTransport = Pick<Transporter, 'sendMail'>;
type SendQueue = Pick<Queue<OutreachSendJobData>, 'add'>;
type SendKind = OutreachSendJobData['sendKind'];

type OutreachSendProcessResult =
  | {
      status: 'skipped';
      reason: 'missing_thread' | 'thread_not_queued' | 'missing_mailbox' | 'already_sent';
    }
  | { status: 'sent'; threadId: number; messageId: number; sendKind: SendKind };

let cachedTransportKey: string | null = null;
let cachedTransporter: MailTransport | null = null;
let followupQueue: SendQueue | null = null;

function getTransporter(config = loadConfig()): MailTransport {
  const key = JSON.stringify({
    host: config.outreach.smtp.host,
    port: config.outreach.smtp.port,
    secure: config.outreach.smtp.secure,
    user: config.outreach.smtp.user,
  });

  if (cachedTransporter && cachedTransportKey === key) {
    return cachedTransporter;
  }

  cachedTransportKey = key;
  cachedTransporter = nodemailer.createTransport({
    host: config.outreach.smtp.host,
    port: config.outreach.smtp.port,
    secure: config.outreach.smtp.secure,
    auth:
      config.outreach.smtp.user && config.outreach.smtp.password
        ? {
            user: config.outreach.smtp.user,
            pass: config.outreach.smtp.password,
          }
        : undefined,
  });
  return cachedTransporter;
}

function getSendQueue(): SendQueue {
  if (!followupQueue) {
    followupQueue = createQueue<OutreachSendJobData>(QUEUE_NAMES.OUTREACH_SEND);
  }
  return followupQueue;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bookkeeping after SMTP accepted an email. Failures are logged, never thrown: a thrown error
 * would fail the job, and a retry would send the email again.
 */
async function finishSentEmail(input: {
  threadId: number;
  message: OutreachMessageRow;
  sendKind: SendKind;
  sentAt: Date;
  providerMessageId: string | null;
  config: ReturnType<typeof loadConfig>;
  sendQueue?: SendQueue;
}): Promise<void> {
  const { threadId, message, sendKind, sentAt, config } = input;
  const followupDelayMs = config.outreach.followupDelayHours * 60 * 60 * 1000;

  let moved: boolean;
  try {
    moved = await outreach.recordSentEmail({
      threadId,
      sendKind,
      to: applyOutreachTransition('queued_send', { type: 'SEND_SUCCEEDED', sendKind }),
      sentAt,
      nextActionAt: sendKind === 'initial' ? new Date(sentAt.getTime() + followupDelayMs) : null,
      event: {
        messageId: message.id,
        eventType: sendKind === 'initial' ? 'initial_sent' : 'followup_sent',
        payload: { providerMessageId: input.providerMessageId },
      },
    });
  } catch (error) {
    log.error('Outreach email sent, but recording it on the thread failed', {
      threadId,
      messageId: message.id,
      error: errorText(error),
    });
    return;
  }

  if (!moved) {
    // Paused, closed or answered while the email was in flight: that state stays, and no
    // automatic follow-up is scheduled.
    log.info('Outreach email sent after the thread left queued_send', {
      threadId,
      messageId: message.id,
    });
    return;
  }
  if (sendKind !== 'initial' || config.outreach.maxAutoFollowups <= 0) return;

  try {
    // One ID per thread, so finishing the same send twice schedules one follow-up.
    await (input.sendQueue ?? getSendQueue()).add(
      `outreach:followup:auto:${threadId}`,
      { threadId, sendKind: 'followup', triggeredBy: 'scheduler' },
      { delay: followupDelayMs, jobId: `outreach-followup-auto-${threadId}` },
    );
  } catch (error) {
    log.error('Outreach email sent, but scheduling its follow-up failed', {
      threadId,
      messageId: message.id,
      error: errorText(error),
    });
  }
}

export async function processOutreachSendJob(
  jobData: OutreachSendJobData,
  deps: {
    config?: ReturnType<typeof loadConfig>;
    transporter?: MailTransport;
    sendQueue?: SendQueue;
    now?: () => Date;
  } = {},
): Promise<OutreachSendProcessResult> {
  const config = deps.config ?? loadConfig();
  const thread = await outreach.findThreadById(jobData.threadId);
  if (!thread) {
    log.warn('Outreach thread not found, skipping', { threadId: jobData.threadId });
    return { status: 'skipped', reason: 'missing_thread' };
  }

  let sendFromState = thread.workflowState;
  if (jobData.sendKind === 'followup' && jobData.triggeredBy === 'scheduler') {
    // The automatic follow-up only runs from sent_waiting_reply. In any other state the
    // thread got a reply, was paused or closed, or another send is already queued.
    if (
      thread.workflowState !== 'sent_waiting_reply' ||
      thread.lastInboundAt != null ||
      thread.autoFollowupCount >= config.outreach.maxAutoFollowups
    ) {
      log.debug('Automatic follow-up no longer due, skipping', {
        threadId: thread.id,
        workflowState: thread.workflowState,
      });
      return { status: 'skipped', reason: 'thread_not_queued' };
    }
    const followupDueState = applyOutreachTransition(thread.workflowState, {
      type: 'FOLLOWUP_DUE',
    });
    const queuedState = applyOutreachTransition(followupDueState, { type: 'RETRY' });
    // Only from sent_waiting_reply, so a reply, pause or close since the read above wins.
    const queued = await outreach.transitionThreadState({
      threadId: thread.id,
      from: ['sent_waiting_reply'],
      to: queuedState,
      nextActionAt: null,
      event: { eventType: 'followup_due', payload: { triggeredBy: 'scheduler' } },
    });
    if (!queued) {
      log.debug('Thread changed before the automatic follow-up, skipping', {
        threadId: thread.id,
      });
      return { status: 'skipped', reason: 'thread_not_queued' };
    }
    sendFromState = queued.workflowState;
  }

  if (sendFromState !== 'queued_send') {
    log.debug('Outreach thread not queued, skipping', {
      threadId: thread.id,
      workflowState: thread.workflowState,
      sendKind: jobData.sendKind,
    });
    return { status: 'skipped', reason: 'thread_not_queued' };
  }

  const mailbox = await mailboxes.findById(thread.mailboxAccountId);
  if (!mailbox) {
    log.warn('Mailbox not found for outreach thread', {
      threadId: thread.id,
      mailboxAccountId: thread.mailboxAccountId,
    });
    return { status: 'skipped', reason: 'missing_mailbox' };
  }

  let message = await outreach.findOutboundMessageByKind(thread.id, jobData.sendKind);
  if (!message) {
    const initial = await outreach.findOutboundMessageByKind(thread.id, 'initial');
    if (!initial) {
      throw new Error(`Missing initial outbound message for thread ${thread.id}`);
    }
    message = await outreach.createOrReuseFollowupDraft({
      threadId: thread.id,
      mailboxAccountId: mailbox.id,
      subject: `Re: ${initial.subject}`,
      bodyText: 'Ich wollte höflich nachfassen und fragen, ob die Immobilie noch verfügbar ist.',
      fromEmail: mailbox.email,
      toEmail: thread.contactEmail,
      inReplyTo: initial.providerMessageId,
      referencesHeader: initial.providerMessageId,
    });
  }

  if (message.deliveryStatus === 'sent') {
    // An earlier attempt sent this email. Never send it twice; finish the bookkeeping that
    // attempt didn't get to, if any.
    const bookkeepingDone =
      thread.lastOutboundAt != null &&
      thread.lastOutboundAt.getTime() >= message.occurredAt.getTime();
    log.warn('Outreach email already sent, not sending again', {
      threadId: thread.id,
      messageId: message.id,
      sendKind: jobData.sendKind,
      bookkeepingDone,
    });
    if (!bookkeepingDone) {
      await finishSentEmail({
        threadId: thread.id,
        message,
        sendKind: jobData.sendKind,
        sentAt: message.occurredAt,
        providerMessageId: message.providerMessageId,
        config,
        sendQueue: deps.sendQueue,
      });
    }
    return { status: 'skipped', reason: 'already_sent' };
  }

  await outreach.updateMessageStatus({ id: message.id, deliveryStatus: 'queued' });

  const transporter = deps.transporter ?? getTransporter(config);
  const fromAddress = config.outreach.fromName
    ? `${config.outreach.fromName} <${mailbox.email}>`
    : mailbox.email;

  let providerMessageId: string | null;
  try {
    const result = await transporter.sendMail({
      from: fromAddress,
      to: thread.contactEmail,
      subject: message.subject,
      text: message.bodyText ?? '',
      html: message.bodyHtml ?? undefined,
      inReplyTo: message.inReplyTo ?? undefined,
      references: message.referencesHeader ?? undefined,
    });
    // nodemailer reports `<id@host>`; replies are matched on the bare ID.
    providerMessageId = result.messageId ? normalizeMessageId(result.messageId) : null;
  } catch (error) {
    await outreach.updateMessageStatus({
      id: message.id,
      deliveryStatus: 'failed',
      errorMessage: errorText(error),
    });
    const failed = await outreach.transitionThreadState({
      threadId: thread.id,
      from: ['queued_send'],
      to: applyOutreachTransition('queued_send', { type: 'SEND_FAILED' }),
      nextActionAt: null,
      event: {
        messageId: message.id,
        eventType: 'send_failed',
        payload: { error: errorText(error) },
      },
    });
    if (!failed) {
      // Paused, closed or answered during the attempt; that state stays.
      log.info('Outreach send failed after the thread left queued_send', {
        threadId: thread.id,
        messageId: message.id,
      });
    }
    throw error;
  }

  // SMTP accepted the email. From here on nothing throws, or the job would fail and a retry
  // would send it again. Recording the send comes first: a retry checks it before sending.
  const sentAt = deps.now?.() ?? new Date();
  try {
    await outreach.updateMessageStatus({
      id: message.id,
      deliveryStatus: 'sent',
      providerMessageId,
      occurredAt: sentAt,
    });
  } catch (error) {
    log.error('Outreach email sent but not recorded; the thread stays queued', {
      threadId: thread.id,
      messageId: message.id,
      providerMessageId,
      error: errorText(error),
    });
    return {
      status: 'sent',
      threadId: thread.id,
      messageId: message.id,
      sendKind: jobData.sendKind,
    };
  }

  await finishSentEmail({
    threadId: thread.id,
    message,
    sendKind: jobData.sendKind,
    sentAt,
    providerMessageId,
    config,
    sendQueue: deps.sendQueue,
  });

  log.info('Outreach email sent', {
    threadId: thread.id,
    messageId: message.id,
    sendKind: jobData.sendKind,
    providerMessageId,
  });

  return {
    status: 'sent',
    threadId: thread.id,
    messageId: message.id,
    sendKind: jobData.sendKind,
  };
}

export function createOutreachSendWorker(): Worker<OutreachSendJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  return new Worker<OutreachSendJobData>(
    QUEUE_NAMES.OUTREACH_SEND,
    async (job: Job<OutreachSendJobData>) => processOutreachSendJob(job.data),
    {
      connection,
      prefix,
      concurrency: WORKER_CONCURRENCY,
    },
  );
}
