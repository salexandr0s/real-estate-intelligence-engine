import nodemailer from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMailboxById: vi.fn(),
  findThreadById: vi.fn(),
  findOutboundMessageByKind: vi.fn(),
  createOrReuseFollowupDraft: vi.fn(),
  updateMessageStatus: vi.fn(),
  recordSentEmail: vi.fn(),
  transitionThreadState: vi.fn(),
}));

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');
  return {
    ...actual,
    mailboxes: {
      ...actual.mailboxes,
      findById: mocks.findMailboxById,
    },
    outreach: {
      ...actual.outreach,
      findThreadById: mocks.findThreadById,
      findOutboundMessageByKind: mocks.findOutboundMessageByKind,
      createOrReuseFollowupDraft: mocks.createOrReuseFollowupDraft,
      updateMessageStatus: mocks.updateMessageStatus,
      recordSentEmail: mocks.recordSentEmail,
      transitionThreadState: mocks.transitionThreadState,
    },
  };
});

import { processOutreachSendJob } from './outreach-send-worker.js';

const SEND_CONFIG = {
  outreach: {
    fromName: 'ImmoRadar',
    followupDelayHours: 72,
    maxAutoFollowups: 1,
    smtp: { host: 'localhost', port: 1025, secure: false, user: '', password: '' },
  },
} as never;

describe('processOutreachSendJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.findThreadById.mockResolvedValue({
      id: 21,
      mailboxAccountId: 10,
      contactEmail: 'broker@example.com',
      workflowState: 'queued_send',
      autoFollowupCount: 0,
    });
    mocks.findMailboxById.mockResolvedValue({ id: 10, email: 'shared@example.com' });
    mocks.findOutboundMessageByKind.mockResolvedValue({
      id: 501,
      subject: 'Hallo',
      bodyText: 'Interested',
      bodyHtml: null,
      inReplyTo: null,
      referencesHeader: null,
      providerMessageId: 'initial-msg-1',
    });
    mocks.updateMessageStatus.mockResolvedValue({});
    mocks.recordSentEmail.mockResolvedValue(true);
    mocks.transitionThreadState.mockImplementation(async (input: { to: string }) => ({
      workflowState: input.to,
    }));
    mocks.createOrReuseFollowupDraft.mockResolvedValue({ id: 502 });
  });

  it('sends the initial email and schedules one automatic follow-up', async () => {
    const transporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: 'provider-123' }),
    };
    const sendQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processOutreachSendJob(
      { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
      {
        transporter,
        sendQueue,
        now: () => new Date('2026-03-26T10:00:00Z'),
        config: SEND_CONFIG,
      },
    );

    expect(result).toEqual({ status: 'sent', threadId: 21, messageId: 501, sendKind: 'initial' });
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'ImmoRadar <shared@example.com>',
        to: 'broker@example.com',
        subject: 'Hallo',
      }),
    );
    expect(mocks.updateMessageStatus).toHaveBeenNthCalledWith(1, {
      id: 501,
      deliveryStatus: 'queued',
    });
    expect(mocks.updateMessageStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 501,
        deliveryStatus: 'sent',
        providerMessageId: 'provider-123',
      }),
    );
    expect(mocks.recordSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        sendKind: 'initial',
        to: 'sent_waiting_reply',
        sentAt: new Date('2026-03-26T10:00:00Z'),
        nextActionAt: new Date('2026-03-29T10:00:00Z'),
      }),
    );
    expect(sendQueue.add).toHaveBeenCalledTimes(1);
  });

  // The worker wrote the state it computed before the SMTP call, so closing the thread during
  // the send reopened it, and the automatic follow-up then emailed the contact again.
  it('keeps a thread closed during the send closed and schedules no follow-up', async () => {
    mocks.recordSentEmail.mockResolvedValue(false);
    const transporter = { sendMail: vi.fn().mockResolvedValue({ messageId: '<provider-123>' }) };
    const sendQueue = { add: vi.fn().mockResolvedValue(undefined) };

    const result = await processOutreachSendJob(
      { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
      { transporter, sendQueue, config: SEND_CONFIG },
    );

    expect(result).toEqual({ status: 'sent', threadId: 21, messageId: 501, sendKind: 'initial' });
    expect(mocks.recordSentEmail).toHaveBeenCalledTimes(1);
    expect(sendQueue.add).not.toHaveBeenCalled();
  });

  it('marks the message and thread as failed when SMTP send fails', async () => {
    const transporter = {
      sendMail: vi.fn().mockRejectedValue(new Error('smtp down')),
    };

    await expect(
      processOutreachSendJob(
        { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
        { transporter, config: SEND_CONFIG },
      ),
    ).rejects.toThrow('smtp down');

    expect(mocks.updateMessageStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 501, deliveryStatus: 'failed', errorMessage: 'smtp down' }),
    );
    expect(mocks.transitionThreadState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        from: ['queued_send'],
        to: 'failed',
        nextActionAt: null,
        event: expect.objectContaining({ eventType: 'send_failed' }),
      }),
    );
  });

  it('sends the scheduled automatic follow-up when the thread is still waiting for a reply', async () => {
    mocks.findThreadById.mockResolvedValue({
      id: 21,
      mailboxAccountId: 10,
      contactEmail: 'broker@example.com',
      workflowState: 'sent_waiting_reply',
      autoFollowupCount: 0,
      lastInboundAt: null,
    });
    mocks.findOutboundMessageByKind.mockImplementation(async (_threadId: number, kind: string) => {
      if (kind === 'followup') {
        return null;
      }
      return {
        id: 501,
        subject: 'Hallo',
        bodyText: 'Interested',
        bodyHtml: null,
        inReplyTo: null,
        referencesHeader: null,
        providerMessageId: 'initial-msg-1',
      };
    });
    mocks.createOrReuseFollowupDraft.mockResolvedValue({
      id: 502,
      subject: 'Re: Hallo',
      bodyText: 'Follow-up',
      bodyHtml: null,
      inReplyTo: 'initial-msg-1',
      referencesHeader: 'initial-msg-1',
      providerMessageId: null,
    });

    const transporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: 'provider-followup-1' }),
    };

    const result = await processOutreachSendJob(
      { threadId: 21, sendKind: 'followup', triggeredBy: 'scheduler' },
      {
        transporter,
        now: () => new Date('2026-03-29T10:00:00Z'),
        config: SEND_CONFIG,
      },
    );

    expect(result).toEqual({ status: 'sent', threadId: 21, messageId: 502, sendKind: 'followup' });
    expect(mocks.transitionThreadState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        from: ['sent_waiting_reply'],
        to: 'queued_send',
        nextActionAt: null,
        event: expect.objectContaining({ eventType: 'followup_due' }),
      }),
    );
    expect(mocks.recordSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        sendKind: 'followup',
        to: 'followup_sent',
        event: expect.objectContaining({ eventType: 'followup_sent' }),
      }),
    );
  });

  // A reply or close between reading the thread and queuing the follow-up was overwritten,
  // and the follow-up went out anyway.
  it('skips the automatic follow-up when the thread changed after it was read', async () => {
    mocks.findThreadById.mockResolvedValue({
      id: 21,
      mailboxAccountId: 10,
      contactEmail: 'broker@example.com',
      workflowState: 'sent_waiting_reply',
      autoFollowupCount: 0,
      lastInboundAt: null,
    });
    mocks.transitionThreadState.mockResolvedValue(null);
    const transporter = { sendMail: vi.fn() };

    const result = await processOutreachSendJob(
      { threadId: 21, sendKind: 'followup', triggeredBy: 'scheduler' },
      { transporter, config: SEND_CONFIG },
    );

    expect(result).toEqual({ status: 'skipped', reason: 'thread_not_queued' });
    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect(mocks.recordSentEmail).not.toHaveBeenCalled();
  });

  // nodemailer reports `<id@host>` while replies are matched on the bare ID, so a stored
  // bracketed ID never matched a reply's In-Reply-To or References.
  it('stores the Message-ID without angle brackets', async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });

    await processOutreachSendJob(
      { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
      { transporter, sendQueue: { add: vi.fn() }, config: SEND_CONFIG },
    );

    expect(mocks.updateMessageStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'sent',
        providerMessageId: expect.stringMatching(/^[^<>\s]+@example\.com$/),
      }),
    );
  });

  // The old catch-all marked a sent email failed when a later write threw, and the retry the
  // app then offered sent it a second time.
  it('keeps an accepted email sent when a later step fails', async () => {
    const transporter = { sendMail: vi.fn().mockResolvedValue({ messageId: '<provider-123>' }) };
    mocks.recordSentEmail.mockRejectedValue(new Error('db down'));
    const sendQueue = { add: vi.fn().mockRejectedValue(new Error('redis down')) };

    const result = await processOutreachSendJob(
      { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
      { transporter, sendQueue, config: SEND_CONFIG },
    );

    expect(result).toEqual({ status: 'sent', threadId: 21, messageId: 501, sendKind: 'initial' });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.updateMessageStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 501,
        deliveryStatus: 'sent',
        providerMessageId: 'provider-123',
      }),
    );
    expect(mocks.updateMessageStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: 'failed' }),
    );
    expect(mocks.transitionThreadState).not.toHaveBeenCalled();
  });

  it('finishes the bookkeeping of a recorded send on a re-run without sending again', async () => {
    const sentAt = new Date('2026-03-26T10:00:00Z');
    mocks.findThreadById.mockResolvedValue({
      id: 21,
      mailboxAccountId: 10,
      contactEmail: 'broker@example.com',
      workflowState: 'queued_send',
      autoFollowupCount: 0,
      lastOutboundAt: null,
    });
    mocks.findOutboundMessageByKind.mockResolvedValue({
      id: 501,
      deliveryStatus: 'sent',
      occurredAt: sentAt,
      providerMessageId: 'provider-123',
    });
    const transporter = { sendMail: vi.fn() };
    const sendQueue = { add: vi.fn().mockResolvedValue(undefined) };

    const result = await processOutreachSendJob(
      { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
      { transporter, sendQueue, config: SEND_CONFIG },
    );

    expect(result).toEqual({ status: 'skipped', reason: 'already_sent' });
    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect(mocks.recordSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sent_waiting_reply', sentAt }),
    );
    expect(sendQueue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sendKind: 'followup' }),
      expect.objectContaining({ jobId: 'outreach-followup-auto-21' }),
    );
  });

  // A failed follow-up kept autoFollowupCount at 0, so its retry was queued as `initial` and
  // the first email went out again.
  it('does not resend an initial email that already went out', async () => {
    const sentAt = new Date('2026-03-26T10:00:00Z');
    mocks.findThreadById.mockResolvedValue({
      id: 21,
      mailboxAccountId: 10,
      contactEmail: 'broker@example.com',
      workflowState: 'queued_send',
      autoFollowupCount: 0,
      lastOutboundAt: sentAt,
    });
    mocks.findOutboundMessageByKind.mockImplementation(async (_threadId: number, kind: string) =>
      kind === 'initial'
        ? { id: 501, deliveryStatus: 'sent', occurredAt: sentAt, subject: 'Hallo' }
        : {
            id: 502,
            deliveryStatus: 'failed',
            subject: 'Re: Hallo',
            bodyText: 'Nachfassen',
            bodyHtml: null,
            inReplyTo: 'initial-msg-1',
            referencesHeader: 'initial-msg-1',
          },
    );
    const transporter = { sendMail: vi.fn().mockResolvedValue({ messageId: '<followup-1>' }) };

    const stale = await processOutreachSendJob(
      { threadId: 21, sendKind: 'initial', triggeredBy: 'manual' },
      { transporter, config: SEND_CONFIG },
    );
    expect(stale).toEqual({ status: 'skipped', reason: 'already_sent' });
    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect(mocks.recordSentEmail).not.toHaveBeenCalled();

    const retried = await processOutreachSendJob(
      { threadId: 21, sendKind: 'followup', triggeredBy: 'manual' },
      { transporter, config: SEND_CONFIG },
    );
    expect(retried).toEqual({ status: 'sent', threadId: 21, messageId: 502, sendKind: 'followup' });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Re: Hallo', text: 'Nachfassen' }),
    );
  });
});
