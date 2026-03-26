import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetConfig } from '@immoradar/config';

const AUTH_HEADER = { authorization: 'Bearer dev-token' };

const hoisted = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  ensureSharedMailbox: vi.fn(),
  findMailboxesByUser: vi.fn(),
  findMailboxByIdForUser: vi.fn(),
  findListingById: vi.fn(),
  findOpenThreadByListingContact: vi.fn(),
  createThreadWithInitialDraft: vi.fn(),
  updateThreadState: vi.fn(),
  updateMessageStatus: vi.fn(),
  appendEvent: vi.fn(),
  findThreadsByUser: vi.fn(),
  findThreadByIdForUser: vi.fn(),
  findMessagesByThreadId: vi.fn(),
  findEventsByThreadId: vi.fn(),
  findAttachmentsByMessageIds: vi.fn(),
  findSummaryForListing: vi.fn(),
  findOutboundMessageByKind: vi.fn(),
  createOrReuseFollowupDraft: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = hoisted.queueAdd;
  },
}));

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');
  return {
    ...actual,
    mailboxes: {
      ...actual.mailboxes,
      ensureSharedMailbox: hoisted.ensureSharedMailbox,
      findByUser: hoisted.findMailboxesByUser,
      findByIdForUser: hoisted.findMailboxByIdForUser,
    },
    listings: {
      ...actual.listings,
      findById: hoisted.findListingById,
    },
    outreach: {
      ...actual.outreach,
      findOpenThreadByListingContact: hoisted.findOpenThreadByListingContact,
      createThreadWithInitialDraft: hoisted.createThreadWithInitialDraft,
      updateThreadState: hoisted.updateThreadState,
      updateMessageStatus: hoisted.updateMessageStatus,
      appendEvent: hoisted.appendEvent,
      findThreadsByUser: hoisted.findThreadsByUser,
      findThreadByIdForUser: hoisted.findThreadByIdForUser,
      findMessagesByThreadId: hoisted.findMessagesByThreadId,
      findEventsByThreadId: hoisted.findEventsByThreadId,
      findAttachmentsByMessageIds: hoisted.findAttachmentsByMessageIds,
      findSummaryForListing: hoisted.findSummaryForListing,
      findOutboundMessageByKind: hoisted.findOutboundMessageByKind,
      createOrReuseFollowupDraft: hoisted.createOrReuseFollowupDraft,
    },
  };
});

describe('mailbox/outreach API routes', () => {
  let app: FastifyInstance;
  let previousEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    previousEnv = {
      OUTREACH_ENABLED: process.env['OUTREACH_ENABLED'],
      OUTREACH_IMAP_USER: process.env['OUTREACH_IMAP_USER'],
      OUTREACH_FROM_NAME: process.env['OUTREACH_FROM_NAME'],
    };
    process.env['OUTREACH_ENABLED'] = 'true';
    process.env['OUTREACH_IMAP_USER'] = 'shared@example.com';
    process.env['OUTREACH_FROM_NAME'] = 'ImmoRadar';
    resetConfig();

    const mod = await import('../../apps/api/src/app.js');
    app = await mod.buildApp();
    await app.ready();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfig();
  });

  beforeEach(() => {
    hoisted.ensureSharedMailbox.mockResolvedValue({
      id: 10,
      userId: 1,
      email: 'shared@example.com',
      displayName: 'Shared Inbox',
      syncStatus: 'healthy',
      pollIntervalSeconds: 60,
      isActive: true,
      lastSeenUid: null,
      lastSeenUidvalidity: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSuccessfulSyncAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date('2026-03-26T10:00:00Z'),
      updatedAt: new Date('2026-03-26T10:00:00Z'),
      mode: 'shared_env',
      providerCode: 'imap_smtp',
      secretRef: 'env:test',
    });
    hoisted.findMailboxesByUser.mockResolvedValue([
      {
        id: 10,
        userId: 1,
        email: 'shared@example.com',
        displayName: 'Shared Inbox',
        syncStatus: 'healthy',
        pollIntervalSeconds: 60,
        isActive: true,
        lastSeenUid: null,
        lastSeenUidvalidity: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSuccessfulSyncAt: new Date('2026-03-26T10:00:00Z'),
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date('2026-03-26T10:00:00Z'),
        updatedAt: new Date('2026-03-26T10:00:00Z'),
        mode: 'shared_env',
        providerCode: 'imap_smtp',
        secretRef: 'env:test',
      },
    ]);
    hoisted.findMailboxByIdForUser.mockResolvedValue({ id: 10 });
    hoisted.findThreadsByUser.mockResolvedValue({
      data: [
        {
          id: 21,
          listingId: 300,
          mailboxAccountId: 10,
          contactName: 'Max Broker',
          contactCompany: 'Broker GmbH',
          contactEmail: 'broker@example.com',
          contactPhone: '+431234567',
          workflowState: 'sent_waiting_reply',
          unreadInboundCount: 1,
          nextActionAt: '2026-03-29T10:00:00.000Z',
          lastInboundAt: null,
          lastOutboundAt: '2026-03-26T10:00:00.000Z',
          updatedAt: '2026-03-26T10:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-1',
    });
    hoisted.findThreadByIdForUser.mockResolvedValue({
      id: 21,
      listingId: 300,
      mailboxAccountId: 10,
      contactName: 'Max Broker',
      contactCompany: 'Broker GmbH',
      contactEmail: 'broker@example.com',
      contactPhone: '+431234567',
      workflowState: 'sent_waiting_reply',
      autoFollowupCount: 0,
      nextActionAt: new Date('2026-03-29T10:00:00Z'),
      lastInboundAt: null,
      lastOutboundAt: new Date('2026-03-26T10:00:00Z'),
      createdAt: new Date('2026-03-26T10:00:00Z'),
      updatedAt: new Date('2026-03-26T10:00:00Z'),
      userId: 1,
    });
    hoisted.findMessagesByThreadId.mockResolvedValue([
      {
        id: 501,
        threadId: 21,
        mailboxAccountId: 10,
        direction: 'outbound',
        messageKind: 'initial',
        deliveryStatus: 'sent',
        providerMessageId: 'msg-1',
        imapUid: null,
        imapUidvalidity: null,
        inReplyTo: null,
        referencesHeader: null,
        subject: 'Hallo',
        bodyText: 'Body',
        bodyHtml: null,
        fromEmail: 'shared@example.com',
        toEmail: 'broker@example.com',
        cc: [],
        bcc: [],
        matchStrategy: 'manual',
        storageKey: null,
        checksum: null,
        errorMessage: null,
        occurredAt: new Date('2026-03-26T10:00:00Z'),
        createdAt: new Date('2026-03-26T10:00:00Z'),
        updatedAt: new Date('2026-03-26T10:00:00Z'),
      },
    ]);
    hoisted.findEventsByThreadId.mockResolvedValue([
      {
        id: 700,
        threadId: 21,
        messageId: 501,
        eventType: 'initial_sent',
        fromState: 'queued_send',
        toState: 'sent_waiting_reply',
        payload: { providerMessageId: 'msg-1', manual: true },
        occurredAt: new Date('2026-03-26T10:00:00Z'),
      },
    ]);
    hoisted.findAttachmentsByMessageIds.mockResolvedValue(new Map([[501, []]]));
    hoisted.findSummaryForListing.mockResolvedValue({
      threadId: 21,
      workflowState: 'sent_waiting_reply',
      unreadInboundCount: 1,
      nextActionAt: '2026-03-29T10:00:00.000Z',
      lastInboundAt: null,
      lastOutboundAt: '2026-03-26T10:00:00.000Z',
    });
    hoisted.findListingById.mockResolvedValue({
      id: 300,
      contactEmail: 'broker@example.com',
      contactName: 'Max Broker',
      contactCompany: 'Broker GmbH',
      contactPhone: '+431234567',
      title: 'Fixture Listing',
    });
    hoisted.findOpenThreadByListingContact.mockResolvedValue(null);
    hoisted.createThreadWithInitialDraft.mockResolvedValue({
      thread: { id: 21 },
      message: { id: 501 },
    });
    hoisted.updateThreadState.mockResolvedValue({ workflowState: 'queued_send' });
    hoisted.updateMessageStatus.mockResolvedValue({});
    hoisted.appendEvent.mockResolvedValue({});
    hoisted.findOutboundMessageByKind.mockResolvedValue({
      id: 501,
      subject: 'Hallo',
      providerMessageId: 'msg-1',
    });
    hoisted.createOrReuseFollowupDraft.mockResolvedValue({ id: 502 });
  });

  it('lists mailboxes', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/mailboxes', headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ email: string }> }>();
    expect(body.data[0]?.email).toBe('shared@example.com');
    expect(hoisted.ensureSharedMailbox).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, email: 'shared@example.com' }),
    );
  });

  it('queues a mailbox sync', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/mailboxes/10/sync',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(hoisted.queueAdd).toHaveBeenCalledTimes(1);
  });

  it('lists outreach threads with cursor pagination metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/outreach/threads?scope=open',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: number }>; meta: { nextCursor: string | null } }>();
    expect(body.data[0]?.id).toBe(21);
    expect(body.meta.nextCursor).toBe('cursor-1');
  });

  it('returns outreach thread detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/outreach/threads/21',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: { id: number; messages: unknown[]; events: Array<{ payload: Record<string, string> }> };
    }>();
    expect(body.data.id).toBe(21);
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.events[0]?.payload.providerMessageId).toBe('msg-1');
    expect(body.data.events[0]?.payload.manual).toBe('true');
  });

  it('starts outreach for a listing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings/300/outreach/start',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: JSON.stringify({ subject: 'Hello', bodyText: 'Interested' }),
    });
    expect(res.statusCode).toBe(201);
    expect(hoisted.createThreadWithInitialDraft).toHaveBeenCalled();
    expect(hoisted.queueAdd).toHaveBeenCalled();
  });

  it('rejects outreach start when no contact email exists', async () => {
    hoisted.findListingById.mockResolvedValueOnce({
      id: 301,
      contactEmail: null,
      contactName: null,
      contactCompany: null,
      contactPhone: null,
      title: 'No Email Listing',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings/301/outreach/start',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: JSON.stringify({ subject: 'Hello', bodyText: 'Interested' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects outreach start when an open thread already exists', async () => {
    hoisted.findOpenThreadByListingContact.mockResolvedValueOnce({ id: 99 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings/300/outreach/start',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: JSON.stringify({ subject: 'Hello', bodyText: 'Interested' }),
    });
    expect(res.statusCode).toBe(409);
  });

  it('applies a thread action', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/outreach/threads/21',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: JSON.stringify({ action: 'pause' }),
    });
    expect(res.statusCode).toBe(200);
    expect(hoisted.updateThreadState).toHaveBeenCalled();
    expect(hoisted.appendEvent).toHaveBeenCalled();
  });

  it('queues a manual follow-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/outreach/threads/21/follow-up',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(hoisted.createOrReuseFollowupDraft).toHaveBeenCalled();
    expect(hoisted.queueAdd).toHaveBeenCalled();
  });

  it('rejects follow-up when a reply already exists', async () => {
    hoisted.findThreadByIdForUser.mockResolvedValueOnce({
      id: 21,
      listingId: 300,
      mailboxAccountId: 10,
      contactName: 'Max Broker',
      contactCompany: 'Broker GmbH',
      contactEmail: 'broker@example.com',
      contactPhone: '+431234567',
      workflowState: 'reply_received',
      autoFollowupCount: 0,
      nextActionAt: null,
      lastInboundAt: new Date('2026-03-26T11:00:00Z'),
      lastOutboundAt: new Date('2026-03-26T10:00:00Z'),
      createdAt: new Date('2026-03-26T10:00:00Z'),
      updatedAt: new Date('2026-03-26T11:00:00Z'),
      userId: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/outreach/threads/21/follow-up',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
  });
});
