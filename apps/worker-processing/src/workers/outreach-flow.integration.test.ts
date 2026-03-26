import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockMailbox {
  id: number;
  userId: number;
  email: string;
  isActive: boolean;
  lastSeenUid: number | null;
  lastSeenUidvalidity: number | null;
  syncStatus?: string;
}

interface MockThread {
  id: number;
  listingId: number;
  mailboxAccountId: number;
  contactEmail: string;
  workflowState:
    | 'draft'
    | 'queued_send'
    | 'sent_waiting_reply'
    | 'reply_received'
    | 'followup_due'
    | 'followup_sent'
    | 'paused'
    | 'closed'
    | 'failed';
  autoFollowupCount: number;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  nextActionAt: Date | null;
}

interface MockMessage {
  id: number;
  threadId: number | null;
  mailboxAccountId: number;
  direction: 'outbound' | 'inbound';
  messageKind: 'initial' | 'followup' | 'reply' | 'system';
  deliveryStatus: 'draft' | 'queued' | 'sent' | 'received' | 'failed' | 'suppressed';
  providerMessageId: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  matchStrategy: 'manual' | 'headers' | 'from_subject' | 'unmatched';
  occurredAt: Date;
  errorMessage?: string | null;
}

interface MockEvent {
  id: number;
  threadId: number;
  messageId: number | null;
  eventType: string;
  fromState: MockThread['workflowState'] | null;
  toState: MockThread['workflowState'] | null;
  payload: Record<string, unknown>;
}

interface MockDocument {
  id: number;
  listingId: number;
  documentType: string;
  label: string;
}

interface MockState {
  mailbox: MockMailbox;
  thread: MockThread;
  messages: MockMessage[];
  events: MockEvent[];
  documents: MockDocument[];
  messageDocuments: Array<{ messageId: number; documentId: number }>;
  nextMessageId: number;
  nextEventId: number;
  nextDocumentId: number;
}

function createState(): MockState {
  return {
    mailbox: {
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      isActive: true,
      lastSeenUid: null,
      lastSeenUidvalidity: null,
      syncStatus: 'healthy',
    },
    thread: {
      id: 21,
      listingId: 300,
      mailboxAccountId: 10,
      contactEmail: 'broker@example.com',
      workflowState: 'queued_send',
      autoFollowupCount: 0,
      lastOutboundAt: null,
      lastInboundAt: null,
      nextActionAt: null,
    },
    messages: [
      {
        id: 501,
        threadId: 21,
        mailboxAccountId: 10,
        direction: 'outbound',
        messageKind: 'initial',
        deliveryStatus: 'draft',
        providerMessageId: null,
        subject: 'Hallo zur Wohnung',
        bodyText: 'Wir interessieren uns für die Wohnung.',
        bodyHtml: null,
        fromEmail: 'shared@example.com',
        toEmail: 'broker@example.com',
        inReplyTo: null,
        referencesHeader: null,
        matchStrategy: 'manual',
        occurredAt: new Date('2026-03-26T09:00:00Z'),
        errorMessage: null,
      },
    ],
    events: [],
    documents: [],
    messageDocuments: [],
    nextMessageId: 700,
    nextEventId: 1,
    nextDocumentId: 900,
  };
}

const testState = vi.hoisted(() => {
  let state = createState();

  return {
    reset() {
      state = createState();
    },
    getState() {
      return state;
    },
  };
});

function cloneMessage(message: MockMessage) {
  return { ...message };
}

function cloneThread(thread: MockThread) {
  return { ...thread };
}

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');

  return {
    ...actual,
    mailboxes: {
      ...actual.mailboxes,
      findById: vi.fn(async (id: number) => {
        const state = testState.getState();
        return id === state.mailbox.id ? { ...state.mailbox } : null;
      }),
      markSyncStarted: vi.fn(async (id: number) => {
        const state = testState.getState();
        if (id === state.mailbox.id) {
          state.mailbox.syncStatus = 'syncing';
        }
      }),
      markSyncFinished: vi.fn(
        async (
          id: number,
          input: {
            status: string;
            lastSeenUid?: number | null;
            lastSeenUidvalidity?: number | null;
          },
        ) => {
          const state = testState.getState();
          if (id === state.mailbox.id) {
            state.mailbox.syncStatus = input.status;
            state.mailbox.lastSeenUid = input.lastSeenUid ?? state.mailbox.lastSeenUid;
            state.mailbox.lastSeenUidvalidity =
              input.lastSeenUidvalidity ?? state.mailbox.lastSeenUidvalidity;
          }
        },
      ),
    },
    outreach: {
      ...actual.outreach,
      findThreadById: vi.fn(async (id: number) => {
        const state = testState.getState();
        return id === state.thread.id ? cloneThread(state.thread) : null;
      }),
      findOutboundMessageByKind: vi.fn(
        async (threadId: number, kind: MockMessage['messageKind']) => {
          const state = testState.getState();
          const message = state.messages.find(
            (entry) =>
              entry.threadId === threadId &&
              entry.direction === 'outbound' &&
              entry.messageKind === kind,
          );
          return message ? cloneMessage(message) : null;
        },
      ),
      createOrReuseFollowupDraft: vi.fn(async () => {
        throw new Error('follow-up path should not run in this integration test');
      }),
      updateMessageStatus: vi.fn(
        async (input: {
          id: number;
          deliveryStatus: MockMessage['deliveryStatus'];
          providerMessageId?: string | null;
          errorMessage?: string | null;
          occurredAt?: Date;
          inReplyTo?: string | null;
          referencesHeader?: string | null;
          threadId?: number | null;
        }) => {
          const state = testState.getState();
          const message = state.messages.find((entry) => entry.id === input.id);
          if (!message) return null;
          message.deliveryStatus = input.deliveryStatus;
          if (input.providerMessageId !== undefined)
            message.providerMessageId = input.providerMessageId;
          if (input.errorMessage !== undefined) message.errorMessage = input.errorMessage;
          if (input.occurredAt) message.occurredAt = input.occurredAt;
          if (input.inReplyTo !== undefined) message.inReplyTo = input.inReplyTo;
          if (input.referencesHeader !== undefined)
            message.referencesHeader = input.referencesHeader;
          if (input.threadId !== undefined) message.threadId = input.threadId;
          return cloneMessage(message);
        },
      ),
      updateThreadState: vi.fn(
        async (input: {
          threadId: number;
          workflowState: MockThread['workflowState'];
          lastOutboundAt?: Date | null;
          lastInboundAt?: Date | null;
          nextActionAt?: Date | null;
          autoFollowupCount?: number;
        }) => {
          const state = testState.getState();
          if (input.threadId !== state.thread.id) return null;
          state.thread.workflowState = input.workflowState;
          if (input.lastOutboundAt !== undefined && input.lastOutboundAt !== null) {
            state.thread.lastOutboundAt = input.lastOutboundAt;
          }
          if (input.lastInboundAt !== undefined && input.lastInboundAt !== null) {
            state.thread.lastInboundAt = input.lastInboundAt;
          }
          if (input.nextActionAt !== undefined) {
            state.thread.nextActionAt = input.nextActionAt;
          }
          if (input.autoFollowupCount !== undefined) {
            state.thread.autoFollowupCount = input.autoFollowupCount;
          }
          return cloneThread(state.thread);
        },
      ),
      appendEvent: vi.fn(
        async (input: {
          threadId: number;
          messageId?: number | null;
          eventType: string;
          fromState?: MockThread['workflowState'] | null;
          toState?: MockThread['workflowState'] | null;
          payload?: Record<string, unknown>;
        }) => {
          const state = testState.getState();
          const event: MockEvent = {
            id: state.nextEventId++,
            threadId: input.threadId,
            messageId: input.messageId ?? null,
            eventType: input.eventType,
            fromState: input.fromState ?? null,
            toState: input.toState ?? null,
            payload: input.payload ?? {},
          };
          state.events.push(event);
          return { ...event, occurredAt: new Date('2026-03-26T09:00:00Z') };
        },
      ),
      findThreadByProviderMessageIds: vi.fn(async (providerMessageIds: string[]) => {
        const state = testState.getState();
        const matched = state.messages.find(
          (entry) =>
            entry.threadId === state.thread.id &&
            entry.providerMessageId != null &&
            providerMessageIds.includes(entry.providerMessageId),
        );
        return matched ? cloneThread(state.thread) : null;
      }),
      findOpenThreadCandidatesByContact: vi.fn(async (userId: number, contactEmail: string) => {
        const state = testState.getState();
        if (
          userId !== state.mailbox.userId ||
          contactEmail !== state.thread.contactEmail ||
          state.thread.workflowState === 'closed'
        ) {
          return [];
        }
        const latestSubject = [...state.messages]
          .filter((entry) => entry.threadId === state.thread.id)
          .sort(
            (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
          )[0]?.subject;
        return [{ thread: cloneThread(state.thread), latestSubject: latestSubject ?? null }];
      }),
      insertInboundMessage: vi.fn(
        async (input: {
          mailboxAccountId: number;
          threadId?: number | null;
          providerMessageId?: string | null;
          subject: string;
          bodyText?: string | null;
          bodyHtml?: string | null;
          fromEmail?: string | null;
          toEmail?: string | null;
          inReplyTo?: string | null;
          referencesHeader?: string | null;
          matchStrategy: MockMessage['matchStrategy'];
          occurredAt?: Date;
          errorMessage?: string | null;
        }) => {
          const state = testState.getState();
          const message: MockMessage = {
            id: state.nextMessageId++,
            threadId: input.threadId ?? null,
            mailboxAccountId: input.mailboxAccountId,
            direction: 'inbound',
            messageKind: 'reply',
            deliveryStatus: 'received',
            providerMessageId: input.providerMessageId ?? null,
            subject: input.subject,
            bodyText: input.bodyText ?? null,
            bodyHtml: input.bodyHtml ?? null,
            fromEmail: input.fromEmail ?? null,
            toEmail: input.toEmail ?? null,
            inReplyTo: input.inReplyTo ?? null,
            referencesHeader: input.referencesHeader ?? null,
            matchStrategy: input.matchStrategy,
            occurredAt: input.occurredAt ?? new Date('2026-03-26T12:00:00Z'),
            errorMessage: input.errorMessage ?? null,
          };
          state.messages.push(message);
          return cloneMessage(message);
        },
      ),
      linkDocumentToMessage: vi.fn(async (messageId: number, documentId: number) => {
        const state = testState.getState();
        state.messageDocuments.push({ messageId, documentId });
      }),
    },
    documents: {
      ...actual.documents,
      upsertDocument: vi.fn(
        async (input: { listingId: number; documentType: string; label: string }) => {
          const state = testState.getState();
          const document: MockDocument = {
            id: state.nextDocumentId++,
            listingId: input.listingId,
            documentType: input.documentType,
            label: input.label,
          };
          state.documents.push(document);
          return { ...document };
        },
      ),
    },
  };
});

import { processMailboxSyncJob } from './mailbox-sync-worker.js';
import { processOutreachSendJob } from './outreach-send-worker.js';

describe('outreach mailbox flow', () => {
  beforeEach(() => {
    testState.reset();
  });

  it('sends an initial mail, matches the reply, and links the PDF attachment', async () => {
    const sendQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };
    const documentQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };
    const transporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: 'provider-initial-123' }),
    };

    const sendResult = await processOutreachSendJob(
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

    expect(sendResult).toEqual({
      status: 'sent',
      threadId: 21,
      messageId: 501,
      sendKind: 'initial',
    });

    const client = {
      mailbox: { uidValidity: 123n },
      connect: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      search: vi.fn().mockResolvedValue([42]),
      fetch: vi.fn().mockImplementation(async function* () {
        yield {
          uid: 42,
          source: Buffer.from('raw-email'),
          envelope: { subject: 'Re: Hallo zur Wohnung' },
          internalDate: new Date('2026-03-26T12:00:00Z'),
        };
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const syncResult = await processMailboxSyncJob(
      { mailboxAccountId: 10, triggeredBy: 'scheduler' },
      {
        clientFactory: () => client,
        parser: vi.fn().mockResolvedValue({
          messageId: '<reply-abc>',
          inReplyTo: '<provider-initial-123>',
          references: '<provider-initial-123>',
          subject: 'Re: Hallo zur Wohnung',
          from: { value: [{ address: 'broker@example.com' }] },
          to: { value: [{ address: 'shared@example.com' }] },
          text: 'Im Anhang finden Sie das Exposé.',
          html: '<p>Im Anhang finden Sie das Exposé.</p>',
          date: new Date('2026-03-26T12:00:00Z'),
          attachments: [
            {
              contentType: 'application/pdf',
              filename: 'Expose.pdf',
              content: Buffer.from('pdf-content'),
            },
          ],
        }),
        storeBuffer: vi
          .fn()
          .mockResolvedValueOnce('mail/raw/fixture.eml')
          .mockResolvedValueOnce('mail/attachments/expose.pdf'),
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

    expect(syncResult).toEqual({
      status: 'completed',
      processedCount: 1,
      unmatchedCount: 0,
      maxUid: 42,
    });

    const state = testState.getState();
    expect(state.thread.workflowState).toBe('reply_received');
    expect(state.thread.lastOutboundAt?.toISOString()).toBe('2026-03-26T10:00:00.000Z');
    expect(state.thread.lastInboundAt?.toISOString()).toBe('2026-03-26T12:00:00.000Z');
    expect(state.thread.nextActionAt).toBeNull();
    expect(state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 501,
          deliveryStatus: 'sent',
          providerMessageId: 'provider-initial-123',
        }),
        expect.objectContaining({
          direction: 'inbound',
          threadId: 21,
          matchStrategy: 'headers',
          providerMessageId: 'reply-abc',
        }),
      ]),
    );
    expect(state.documents).toEqual([
      expect.objectContaining({
        listingId: 300,
        documentType: 'email_attachment',
        label: 'Expose.pdf',
      }),
    ]);
    expect(state.messageDocuments).toEqual([{ messageId: 700, documentId: 900 }]);
    expect(sendQueue.add).toHaveBeenCalledTimes(1);
    expect(documentQueue.add).toHaveBeenCalledTimes(1);
    expect(state.events.map((event) => event.eventType)).toEqual([
      'initial_sent',
      'reply_received',
    ]);
  });
});
