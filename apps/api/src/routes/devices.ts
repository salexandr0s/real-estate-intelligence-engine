import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deviceTokens } from '@immoradar/db';
import { parseOrThrow } from '../schemas.js';

const deviceTokenSchema = z.object({
  token: z.string().min(1).max(200),
  platform: z.enum(['apns', 'apns_sandbox']),
  appVersion: z.string().max(50).optional(),
});

const deleteTokenSchema = z.object({
  token: z.string().min(1).max(200),
});

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // PUT /v1/devices/token — register or refresh a device token
  app.put(
    '/v1/devices/token',
    {
      schema: {
        tags: ['Devices'],
        summary: 'Register or refresh a push notification device token',
        body: {
          type: 'object',
          required: ['token', 'platform'],
          properties: {
            token: { type: 'string' },
            platform: { type: 'string', enum: ['apns', 'apns_sandbox'] },
            appVersion: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { token, platform, appVersion } = parseOrThrow(deviceTokenSchema, request.body);

      const row = await deviceTokens.upsert(userId, token, platform, appVersion);

      return reply.status(200).send({
        id: row.id,
        token: row.token,
        platform: row.platform,
        lastUsedAt: row.lastUsedAt,
      });
    },
  );

  // DELETE /v1/devices/token — unregister a device token
  app.delete(
    '/v1/devices/token',
    {
      schema: {
        tags: ['Devices'],
        summary: 'Unregister a push notification device token',
        body: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { token } = parseOrThrow(deleteTokenSchema, request.body);

      const deleted = await deviceTokens.removeByUserAndToken(userId, token);

      return reply.status(200).send({ deleted });
    },
  );
}
