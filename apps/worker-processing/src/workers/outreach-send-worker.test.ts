import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMailboxById: vi.fn(),
  findThreadById: vi.fn(),
  findOutboundMessageByKind: vi.fn(),
  createOrReuseFollowupDraft: vi.fn(),
  updateMessageStatus: vi.fn(),
  updateThreadState: vi.fn(),
  appendEvent: vi.fn(),
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
      updateThreadState: mocks.updateThreadState,
      appendEvent: mocks.appendEvent,
    },
  };
});

import { processOutreachSendJob } from './outreach-send-worker.js';

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
    mocks.updateThreadState.mockResolvedValue({});
    mocks.appendEvent.mockResolvedValue({});
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
        config: {
          outreach: {
            fromName: 'ImmoRadar',
            followupDelayHours: 72,
            maxAutoFollowups: 1,
            smtp: { host: 'localhost', port: 1025, secure: false, user: '', password: '' },
          },
        } as never,
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
    expect(mocks.updateThreadState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        workflowState: 'sent_waiting_reply',
        autoFollowupCount: 0,
      }),
    );
    expect(sendQueue.add).toHaveBeenCalledTimes(1);
  });

  it('marks the message and thread as failed when SMTP send fails', async () => {
    const transporter = {
      sendMail: vi.fn().mockRejectedValue(new Error('smtp down')),
    };

    await expect(
      processOutreachSendJob(
        { threadId: 21, sendKind: 'initial', triggeredBy: 'api' },
        {
          transporter,
          config: {
            outreach: {
              fromName: 'ImmoRadar',
              followupDelayHours: 72,
              maxAutoFollowups: 1,
              smtp: { host: 'localhost', port: 1025, secure: false, user: '', password: '' },
            },
          } as never,
        },
      ),
    ).rejects.toThrow('smtp down');

    expect(mocks.updateMessageStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 501, deliveryStatus: 'failed', errorMessage: 'smtp down' }),
    );
    expect(mocks.updateThreadState).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 21, workflowState: 'failed', nextActionAt: null }),
    );
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'send_failed', toState: 'failed' }),
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
        config: {
          outreach: {
            fromName: 'ImmoRadar',
            followupDelayHours: 72,
            maxAutoFollowups: 1,
            smtp: { host: 'localhost', port: 1025, secure: false, user: '', password: '' },
          },
        } as never,
      },
    );

    expect(result).toEqual({ status: 'sent', threadId: 21, messageId: 502, sendKind: 'followup' });
    expect(mocks.updateThreadState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        threadId: 21,
        workflowState: 'queued_send',
        nextActionAt: null,
      }),
    );
    expect(mocks.appendEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'followup_due',
        fromState: 'sent_waiting_reply',
        toState: 'queued_send',
      }),
    );
    expect(mocks.updateThreadState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        threadId: 21,
        workflowState: 'followup_sent',
        autoFollowupCount: 1,
      }),
    );
    expect(mocks.appendEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'followup_sent',
        fromState: 'queued_send',
        toState: 'followup_sent',
      }),
    );
  });
});
