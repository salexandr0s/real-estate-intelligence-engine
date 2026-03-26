import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMailboxById: vi.fn(),
  markSyncStarted: vi.fn(),
  markSyncFinished: vi.fn(),
  findThreadByProviderMessageIds: vi.fn(),
  findOpenThreadCandidatesByContact: vi.fn(),
  insertInboundMessage: vi.fn(),
  updateThreadState: vi.fn(),
  appendEvent: vi.fn(),
  linkDocumentToMessage: vi.fn(),
  upsertDocument: vi.fn(),
}));

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');
  return {
    ...actual,
    mailboxes: {
      ...actual.mailboxes,
      findById: mocks.findMailboxById,
      markSyncStarted: mocks.markSyncStarted,
      markSyncFinished: mocks.markSyncFinished,
    },
    outreach: {
      ...actual.outreach,
      findThreadByProviderMessageIds: mocks.findThreadByProviderMessageIds,
      findOpenThreadCandidatesByContact: mocks.findOpenThreadCandidatesByContact,
      insertInboundMessage: mocks.insertInboundMessage,
      updateThreadState: mocks.updateThreadState,
      appendEvent: mocks.appendEvent,
      linkDocumentToMessage: mocks.linkDocumentToMessage,
    },
    documents: {
      ...actual.documents,
      upsertDocument: mocks.upsertDocument,
    },
  };
});

import { processMailboxSyncJob } from './mailbox-sync-worker.js';

describe('processMailboxSyncJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMailboxById.mockResolvedValue({
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      isActive: true,
      lastSeenUid: null,
      lastSeenUidvalidity: null,
    });
    mocks.markSyncStarted.mockResolvedValue(undefined);
    mocks.markSyncFinished.mockResolvedValue(undefined);
    mocks.findOpenThreadCandidatesByContact.mockResolvedValue([]);
    mocks.updateThreadState.mockResolvedValue({});
    mocks.appendEvent.mockResolvedValue({});
    mocks.linkDocumentToMessage.mockResolvedValue(undefined);
    mocks.upsertDocument.mockResolvedValue({ id: 900 });
  });

  it('matches replies by headers, stores raw mail, and forwards PDF attachments', async () => {
    const lockRelease = vi.fn();
    const client = {
      mailbox: { uidValidity: 123n },
      connect: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: lockRelease }),
      search: vi.fn().mockResolvedValue([42]),
      fetch: vi.fn().mockImplementation(async function* () {
        yield {
          uid: 42,
          source: Buffer.from('raw-email'),
          envelope: { subject: 'Re: Hallo' },
          internalDate: new Date('2026-03-26T11:00:00Z'),
        };
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    mocks.findThreadByProviderMessageIds.mockResolvedValue({
      id: 21,
      listingId: 300,
      workflowState: 'sent_waiting_reply',
    });
    mocks.insertInboundMessage.mockResolvedValue({
      id: 701,
      occurredAt: new Date('2026-03-26T11:00:00Z'),
    });

    const documentQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };
    const storeBuffer = vi.fn().mockResolvedValue('storage-key');
    const parser = vi.fn().mockResolvedValue({
      messageId: '<reply-1>',
      inReplyTo: '<out-1>',
      references: '<out-1>',
      subject: 'Re: Hallo',
      from: { value: [{ address: 'broker@example.com' }] },
      to: { value: [{ address: 'shared@example.com' }] },
      text: 'Danke für Ihr Interesse',
      html: '<p>Danke</p>',
      date: new Date('2026-03-26T11:00:00Z'),
      attachments: [
        {
          contentType: 'application/pdf',
          filename: 'Expose.pdf',
          content: Buffer.from('pdf-binary'),
        },
        {
          contentType: 'text/plain',
          filename: 'notes.txt',
          content: Buffer.from('ignore'),
        },
      ],
    });

    const result = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser,
        storeBuffer,
        documentQueue,
        now: () => new Date('2026-03-26T12:00:00Z'),
        config: {
          outreach: {
            imap: {
              host: 'localhost',
              port: 993,
              secure: true,
              user: 'shared@example.com',
              password: 'secret',
              mailbox: 'INBOX',
            },
            initialLookbackDays: 7,
          },
        } as never,
      },
    );

    expect(result).toEqual({
      status: 'completed',
      processedCount: 1,
      unmatchedCount: 0,
      maxUid: 42,
    });
    expect(mocks.insertInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxAccountId: 10,
        threadId: 21,
        matchStrategy: 'headers',
        providerMessageId: 'reply-1',
      }),
    );
    expect(mocks.updateThreadState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        workflowState: 'reply_received',
        nextActionAt: null,
      }),
    );
    expect(mocks.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: 300,
        documentType: 'email_attachment',
        label: 'Expose.pdf',
      }),
    );
    expect(mocks.linkDocumentToMessage).toHaveBeenCalledWith(701, 900);
    expect(documentQueue.add).toHaveBeenCalledTimes(1);
    expect(mocks.markSyncFinished).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: 'healthy', lastSeenUid: 42, lastSeenUidvalidity: 123 }),
    );
    expect(lockRelease).toHaveBeenCalled();
    expect(client.logout).toHaveBeenCalled();
  });

  it('preserves unmatched inbound mail and marks the sync degraded', async () => {
    const client = {
      mailbox: { uidValidity: 321n },
      connect: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      search: vi.fn().mockResolvedValue([7]),
      fetch: vi.fn().mockImplementation(async function* () {
        yield {
          uid: 7,
          source: Buffer.from('raw-email'),
          envelope: { subject: 'General question' },
          internalDate: new Date('2026-03-26T11:30:00Z'),
        };
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    mocks.findThreadByProviderMessageIds.mockResolvedValue(null);
    mocks.findOpenThreadCandidatesByContact.mockResolvedValue([]);
    mocks.insertInboundMessage.mockResolvedValue({
      id: 702,
      occurredAt: new Date('2026-03-26T11:30:00Z'),
    });

    const result = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser: vi.fn().mockResolvedValue({
          messageId: '<reply-2>',
          inReplyTo: null,
          references: null,
          subject: 'General question',
          from: { value: [{ address: 'unknown@example.com' }] },
          to: { value: [{ address: 'shared@example.com' }] },
          text: 'Is this still available?',
          html: null,
          date: new Date('2026-03-26T11:30:00Z'),
          attachments: [],
        }),
        storeBuffer: vi.fn().mockResolvedValue('storage-key'),
        documentQueue: { add: vi.fn() },
        now: () => new Date('2026-03-26T12:00:00Z'),
        config: {
          outreach: {
            imap: {
              host: 'localhost',
              port: 993,
              secure: true,
              user: 'shared@example.com',
              password: 'secret',
              mailbox: 'INBOX',
            },
            initialLookbackDays: 7,
          },
        } as never,
      },
    );

    expect(result).toEqual({
      status: 'completed',
      processedCount: 1,
      unmatchedCount: 1,
      maxUid: 7,
    });
    expect(mocks.insertInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: null,
        matchStrategy: 'unmatched',
        errorMessage: 'thread_unmatched',
      }),
    );
    expect(mocks.updateThreadState).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(mocks.upsertDocument).not.toHaveBeenCalled();
    expect(mocks.markSyncFinished).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: 'degraded', errorMessage: '1 unmatched inbound messages' }),
    );
  });
});
