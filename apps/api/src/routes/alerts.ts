import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@rei/observability';
import type { AlertStatus } from '@rei/contracts';
import { alerts } from '@rei/db';
import {
  parseOrThrow,
  idParamSchema,
  alertUpdateSchema,
  alertBulkUpdateSchema,
  paginationQuerySchema,
} from '../schemas.js';

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/alerts - List alerts with cursor pagination
  app.get(
    '/v1/alerts',
    {
      schema: {
        tags: ['Alerts'],
        summary: 'List alerts with cursor pagination',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size' },
            cursor: { type: 'string', description: 'Pagination cursor' },
          },
          additionalProperties: true,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { limit, cursor } = parseOrThrow(paginationQuerySchema, request.query);

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
        matchReasons: alert.matchReasons,
        matchedAt: alert.matchedAt.toISOString(),
        sentAt: alert.sentAt?.toISOString() ?? null,
        createdAt: alert.createdAt.toISOString(),
        filterName: alert.filterName,
      }));

      return reply.send({
        data: mappedData,
        meta: {
          nextCursor: result.nextCursor,
          pageSize: limit ?? 25,
        },
      });
    },
  );

  // PATCH /v1/alerts/bulk - Bulk update alert status
  app.patch('/v1/alerts/bulk', async (request, reply) => {
    const { action, ids, filter } = parseOrThrow(alertBulkUpdateSchema, request.body);
    const userId = request.userId;

    let updatedCount: number;
    if (ids) {
      updatedCount = await alerts.bulkUpdateStatus(ids, action as AlertStatus, userId);
    } else {
      const currentStatus = (filter?.status as AlertStatus) ?? null;
      updatedCount = await alerts.bulkUpdateByFilter(userId, currentStatus, action as AlertStatus);
    }

    return reply.send({
      data: { updatedCount },
      meta: {},
    });
  });

  // PATCH /v1/alerts/:id - Update alert status
  app.patch<{ Params: { id: string } }>('/v1/alerts/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { status } = parseOrThrow(alertUpdateSchema, request.body);

    // Verify ownership
    const existing = await alerts.findById(id);
    if (!existing || existing.userId !== request.userId) {
      throw new NotFoundError('Alert', id);
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
        matchReasons: alert.matchReasons,
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
