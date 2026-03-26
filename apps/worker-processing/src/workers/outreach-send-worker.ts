import nodemailer from 'nodemailer';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import { mailboxes, outreach } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import { applyOutreachTransition } from '@immoradar/outreach';
import { QUEUE_NAMES, getQueuePrefix, getRedisConnection } from '@immoradar/scraper-core';
import type { OutreachSendJobData } from '@immoradar/scraper-core';

const log = createLogger('worker:outreach-send');

type MailTransport = Pick<nodemailer.Transporter, 'sendMail'>;
type SendQueue = Pick<Queue<OutreachSendJobData>, 'add'>;

type OutreachSendProcessResult =
  | { status: 'skipped'; reason: 'missing_thread' | 'thread_not_queued' | 'missing_mailbox' }
  | { status: 'sent'; threadId: number; messageId: number; sendKind: 'initial' | 'followup' };

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
    followupQueue = new Queue<OutreachSendJobData>(QUEUE_NAMES.OUTREACH_SEND, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
  }
  return followupQueue;
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
  if (
    jobData.sendKind === 'followup' &&
    jobData.triggeredBy === 'scheduler' &&
    thread.workflowState === 'sent_waiting_reply' &&
    thread.lastInboundAt == null &&
    thread.autoFollowupCount < config.outreach.maxAutoFollowups
  ) {
    const followupDueState = applyOutreachTransition(thread.workflowState, {
      type: 'FOLLOWUP_DUE',
    });
    const queuedState = applyOutreachTransition(followupDueState, { type: 'RETRY' });
    await outreach.updateThreadState({
      threadId: thread.id,
      workflowState: queuedState,
      nextActionAt: null,
    });
    await outreach.appendEvent({
      threadId: thread.id,
      eventType: 'followup_due',
      fromState: thread.workflowState,
      toState: queuedState,
      payload: { triggeredBy: 'scheduler' },
    });
    sendFromState = queuedState;
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

  await outreach.updateMessageStatus({ id: message.id, deliveryStatus: 'queued' });

  const transporter = deps.transporter ?? getTransporter(config);
  const fromAddress = config.outreach.fromName
    ? `${config.outreach.fromName} <${mailbox.email}>`
    : mailbox.email;

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

    const sentAt = deps.now?.() ?? new Date();
    await outreach.updateMessageStatus({
      id: message.id,
      deliveryStatus: 'sent',
      providerMessageId: result.messageId ?? null,
      occurredAt: sentAt,
    });

    const nextState = applyOutreachTransition(sendFromState, {
      type: 'SEND_SUCCEEDED',
      sendKind: jobData.sendKind,
    });
    const autoFollowupCount =
      jobData.sendKind === 'followup' ? thread.autoFollowupCount + 1 : thread.autoFollowupCount;
    const nextActionAt =
      jobData.sendKind === 'initial'
        ? new Date(sentAt.getTime() + config.outreach.followupDelayHours * 60 * 60 * 1000)
        : null;

    await outreach.updateThreadState({
      threadId: thread.id,
      workflowState: nextState,
      lastOutboundAt: sentAt,
      nextActionAt,
      autoFollowupCount,
    });
    await outreach.appendEvent({
      threadId: thread.id,
      messageId: message.id,
      eventType: jobData.sendKind === 'initial' ? 'initial_sent' : 'followup_sent',
      fromState: sendFromState,
      toState: nextState,
      payload: { providerMessageId: result.messageId ?? null },
    });

    if (jobData.sendKind === 'initial' && config.outreach.maxAutoFollowups > 0) {
      const sendQueue = deps.sendQueue ?? getSendQueue();
      await sendQueue.add(
        `outreach:followup:auto:${thread.id}:${Date.now()}`,
        { threadId: thread.id, sendKind: 'followup', triggeredBy: 'scheduler' },
        { delay: config.outreach.followupDelayHours * 60 * 60 * 1000 },
      );
    }

    log.info('Outreach email sent', {
      threadId: thread.id,
      messageId: message.id,
      sendKind: jobData.sendKind,
      providerMessageId: result.messageId ?? null,
    });

    return {
      status: 'sent',
      threadId: thread.id,
      messageId: message.id,
      sendKind: jobData.sendKind,
    };
  } catch (error) {
    const nextState = applyOutreachTransition(sendFromState, { type: 'SEND_FAILED' });
    await outreach.updateMessageStatus({
      id: message.id,
      deliveryStatus: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    await outreach.updateThreadState({
      threadId: thread.id,
      workflowState: nextState,
      nextActionAt: null,
    });
    await outreach.appendEvent({
      threadId: thread.id,
      messageId: message.id,
      eventType: 'send_failed',
      fromState: sendFromState,
      toState: nextState,
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
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
      concurrency: 2,
    },
  );
}
