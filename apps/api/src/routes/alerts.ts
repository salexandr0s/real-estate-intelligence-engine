import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '@rei/observability';
import type { AlertStatus } from '@rei/contracts';
import { alerts } from '@rei/db';

const VALID_ALERT_STATUSES = new Set<string>(['queued', 'sent', 'failed', 'dismissed', 'opened', 'suppressed']);

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/alerts - List alerts with cursor pagination
  app.get('/v1/alerts', async (request, reply) => {
    const userId = request.userId;
    const query = request.query as Record<string, unknown>;

    const limit = query['limit'] != null ? parseInt(String(query['limit']), 10) : undefined;
    const cursor = query['cursor'] as string | undefined;

    if (limit != null && (Number.isNaN(limit) || limit < 1 || limit > 200)) {
      throw new ValidationError('limit must be between 1 and 200', { field: 'limit' });
    }

    const result = await alerts.findByUser(userId, null, cursor ?? null, limit);

    const mappedData = result.data.map((alert) => ({
      id: alert.id,
      userFilterId: alert.userFilterId,
      listingId: alert.listingId,
      alertType: alert.alertType,
      channel: alert.channel,
      status: alert.status,
      title: alert.title,
      body: alert.body,
      payload: alert.payload,
      matchedAt: alert.matchedAt.toISOString(),
      sentAt: alert.sentAt?.toISOString() ?? null,
      createdAt: alert.createdAt.toISOString(),
    }));

    return reply.send({
      data: mappedData,
      meta: {
        nextCursor: result.nextCursor,
        pageSize: limit ?? 25,
      },
    });
  });

  // PATCH /v1/alerts/:id - Update alert status
  app.patch<{ Params: { id: string } }>('/v1/alerts/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid alert id', { field: 'id' });
    }

    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body is required');
    }

    const status = body['status'] as string;
    if (!status || !VALID_ALERT_STATUSES.has(status)) {
      throw new ValidationError(`status must be one of: ${[...VALID_ALERT_STATUSES].join(', ')}`, { field: 'status' });
    }

    const alert = await alerts.updateStatus(id, status as AlertStatus);
    if (!alert) {
      throw new NotFoundError('Alert', id);
    }

    return reply.send({
      data: {
        id: alert.id,
        userFilterId: alert.userFilterId,
        listingId: alert.listingId,
        alertType: alert.alertType,
        channel: alert.channel,
        status: alert.status,
        title: alert.title,
        body: alert.body,
        payload: alert.payload,
        matchedAt: alert.matchedAt.toISOString(),
        sentAt: alert.sentAt?.toISOString() ?? null,
        createdAt: alert.createdAt.toISOString(),
      },
      meta: {},
    });
  });

  // GET /v1/alerts/unread-count - Get unread count
  app.get('/v1/alerts/unread-count', async (request, reply) => {
    const userId = request.userId;

    const unreadCount = await alerts.countUnread(userId);

    return reply.send({
      data: {
        unreadCount,
      },
      meta: {},
    });
  });
}
