import type { FastifyInstance } from 'fastify';
import { registry } from '@immoradar/observability';
import { constantTimeEquals } from '../middleware/auth.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  const metricsToken = process.env.METRICS_TOKEN ?? null;

  app.get('/metrics', async (request, reply) => {
    if (metricsToken) {
      const authHeader = request.headers.authorization ?? '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!bearer || !constantTimeEquals(bearer, metricsToken)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    }

    const body = await registry.metrics();
    return reply.type(registry.contentType).send(body);
  });
}
