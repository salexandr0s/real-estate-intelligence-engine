import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMailboxById: vi.fn(),
  markSyncStarted: vi.fn(),
  markSyncFinished: vi.fn(),
  findThreadByProviderMessageIds: vi.fn(),
  findOpenThreadCandidatesByContact: vi.fn(),
  findMessageByProviderId: vi.fn(),
  recordInboundMessage: vi.fn(),
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
      findMessageByProviderId: mocks.findMessageByProviderId,
      recordInboundMessage: mocks.recordInboundMessage,
      linkDocumentToMessage: mocks.linkDocumentToMessage,
    },
    documents: {
      ...actual.documents,
      upsertDocument: mocks.upsertDocument,
    },
  };
});

import { processMailboxSyncJob } from './mailbox-sync-worker.js';

const SYNC_CONFIG = {
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
} as never;

/** A fake IMAP client whose messages carry their Message-ID as the raw source. */
function fakeImap(uidValidity: bigint, messages: Array<{ uid: number; messageId: string }>) {
  return {
    mailbox: { uidValidity },
    connect: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue(messages.map((message) => message.uid)),
    fetch: vi.fn().mockImplementation(async function* (ids: number[]) {
      for (const message of messages) {
        if (ids.includes(message.uid)) {
          yield { uid: message.uid, source: Buffer.from(message.messageId), envelope: {} };
        }
      }
    }),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

function parsedMail(messageId: string) {
  return {
    messageId,
    inReplyTo: undefined,
    references: undefined,
    subject: 'Frage',
    from: { value: [{ address: 'someone@example.com' }] },
    to: { value: [{ address: 'shared@example.com' }] },
    text: 'Hallo',
    html: false,
    date: new Date('2026-03-26T11:00:00Z'),
    attachments: [],
  } as never;
}

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
    mocks.findMessageByProviderId.mockResolvedValue(null);
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
    mocks.recordInboundMessage.mockResolvedValue({
      message: { id: 701, occurredAt: new Date('2026-03-26T11:00:00Z') },
      inserted: true,
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
    expect(mocks.findThreadByProviderMessageIds).toHaveBeenCalledWith(1, ['out-1']);
    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxAccountId: 10,
        threadId: 21,
        matchStrategy: 'headers',
        providerMessageId: 'reply-1',
      }),
      expect.any(Function),
    );
    // The state comes from the thread as locked when the reply is stored, not as read here.
    const replyState = mocks.recordInboundMessage.mock.calls[0]?.[1] as (
      current: string,
    ) => string | null;
    expect(replyState('queued_send')).toBe('reply_received');
    expect(replyState('closed')).toBeNull();
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
    mocks.recordInboundMessage.mockResolvedValue({
      message: { id: 702, occurredAt: new Date('2026-03-26T11:30:00Z') },
      inserted: true,
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
    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: null,
        matchStrategy: 'unmatched',
        errorMessage: 'thread_unmatched',
      }),
      null,
    );
    expect(mocks.upsertDocument).not.toHaveBeenCalled();
    expect(mocks.markSyncFinished).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: 'degraded', errorMessage: '1 unmatched inbound messages' }),
    );
  });

  it('falls back to sender plus normalized subject matching when headers are missing', async () => {
    const client = {
      mailbox: { uidValidity: 123n },
      connect: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      search: vi.fn().mockResolvedValue([8]),
      fetch: vi.fn().mockImplementation(async function* () {
        yield {
          uid: 8,
          source: Buffer.from('raw-email'),
          envelope: { subject: 'AW: Hallo' },
          internalDate: new Date('2026-03-26T11:15:00Z'),
        };
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    mocks.findThreadByProviderMessageIds.mockResolvedValue(null);
    mocks.findOpenThreadCandidatesByContact.mockResolvedValue([
      {
        thread: {
          id: 21,
          listingId: 300,
          workflowState: 'sent_waiting_reply',
        },
        latestSubject: 'Hallo',
      },
    ]);
    mocks.recordInboundMessage.mockResolvedValue({
      message: { id: 703, occurredAt: new Date('2026-03-26T11:15:00Z') },
      inserted: true,
    });

    const result = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser: vi.fn().mockResolvedValue({
          messageId: '<reply-3>',
          inReplyTo: null,
          references: null,
          subject: 'AW: Hallo',
          from: { value: [{ address: 'broker@example.com' }] },
          to: { value: [{ address: 'shared@example.com' }] },
          text: 'Danke, hier die Unterlagen.',
          html: null,
          date: new Date('2026-03-26T11:15:00Z'),
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
      unmatchedCount: 0,
      maxUid: 8,
    });
    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 21,
        matchStrategy: 'from_subject',
      }),
      expect.any(Function),
    );
  });

  it('resumes from the next UID after the last successful sync cursor', async () => {
    mocks.findMailboxById.mockResolvedValue({
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      isActive: true,
      lastSeenUid: 41,
      lastSeenUidvalidity: 123,
    });

    const client = {
      mailbox: { uidValidity: 123n },
      connect: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      search: vi.fn().mockResolvedValue([]),
      fetch: vi.fn().mockImplementation(async function* () {}),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser: vi.fn(),
        storeBuffer: vi.fn(),
        documentQueue: { add: vi.fn() },
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
      processedCount: 0,
      unmatchedCount: 0,
      maxUid: 41,
    });
    expect(client.search).toHaveBeenCalledWith({ uid: '42:*' }, { uid: true });
  });

  it('marks the sync failed and preserves the last seen cursor on IMAP errors', async () => {
    mocks.findMailboxById.mockResolvedValue({
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      isActive: true,
      lastSeenUid: 41,
      lastSeenUidvalidity: 123,
    });

    const client = {
      mailbox: { uidValidity: 123n },
      connect: vi.fn().mockRejectedValue(new Error('imap down')),
      getMailboxLock: vi.fn(),
      search: vi.fn(),
      fetch: vi.fn(),
      logout: vi.fn(),
    };

    await expect(
      processMailboxSyncJob(
        { mailboxAccountId: 10, triggeredBy: 'scheduler' },
        {
          clientFactory: () => client,
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
      ),
    ).rejects.toThrow('imap down');

    expect(mocks.markSyncFinished).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        status: 'failed',
        lastSeenUid: 41,
        lastSeenUidvalidity: 123,
        errorCode: 'mailbox_sync_failed',
        errorMessage: 'imap down',
      }),
    );
  });

  // IMAP answers `UID 43:*` with the newest message (UID 42) even when nothing is new, so
  // every sync handled that message again: another raw copy, event and attachment job.
  it('processes nothing when the only UID IMAP returns is the cursor itself', async () => {
    mocks.findMailboxById.mockResolvedValue({
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      isActive: true,
      lastSeenUid: 42,
      lastSeenUidvalidity: 123,
    });
    const client = fakeImap(123n, [{ uid: 42, messageId: '<reply-1>' }]);
    const parser = vi.fn();

    const result = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser,
        storeBuffer: vi.fn(),
        documentQueue: { add: vi.fn() },
        config: SYNC_CONFIG,
      },
    );

    expect(result).toEqual({
      status: 'completed',
      processedCount: 0,
      unmatchedCount: 0,
      maxUid: 42,
    });
    expect(client.search).toHaveBeenCalledWith({ uid: '43:*' }, { uid: true });
    expect(client.fetch).not.toHaveBeenCalled();
    expect(parser).not.toHaveBeenCalled();
    expect(mocks.recordInboundMessage).not.toHaveBeenCalled();
    expect(mocks.markSyncFinished).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: 'healthy', lastSeenUid: 42, lastSeenUidvalidity: 123 }),
    );
  });

  // After the server renumbers a mailbox, the old cursor (900) would skip the new UIDs 3-4.
  it('rescans the lookback window after a UIDVALIDITY change and skips mail already stored', async () => {
    mocks.findMailboxById.mockResolvedValue({
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      isActive: true,
      lastSeenUid: 900,
      lastSeenUidvalidity: 123,
    });
    const client = fakeImap(456n, [
      { uid: 3, messageId: '<known@example.com>' },
      { uid: 4, messageId: '<new@example.com>' },
    ]);
    mocks.findMessageByProviderId.mockImplementation(async (_mailboxId: number, id: string) =>
      id === 'known@example.com' ? { id: 650 } : null,
    );
    mocks.findThreadByProviderMessageIds.mockResolvedValue(null);
    mocks.recordInboundMessage.mockResolvedValue({
      message: { id: 704, occurredAt: new Date('2026-03-26T11:00:00Z') },
      inserted: true,
    });

    const result = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser: async (source: Buffer) => parsedMail(source.toString()),
        storeBuffer: vi.fn().mockResolvedValue('storage-key'),
        documentQueue: { add: vi.fn() },
        now: () => new Date('2026-03-26T12:00:00Z'),
        config: SYNC_CONFIG,
      },
    );

    expect(client.search).toHaveBeenCalledWith({ since: expect.any(Date) }, { uid: true });
    expect(mocks.recordInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: 'new@example.com', imapUidvalidity: 456 }),
      null,
    );
    expect(result).toEqual({
      status: 'completed',
      processedCount: 1,
      unmatchedCount: 1,
      maxUid: 4,
    });
    expect(mocks.markSyncFinished).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ lastSeenUid: 4, lastSeenUidvalidity: 456 }),
    );
  });
});
