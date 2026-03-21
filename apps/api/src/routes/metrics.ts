import type { FastifyInstance } from 'fastify';
import { registry } from '@rei/observability';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    const body = await registry.metrics();
    return reply.type(registry.contentType).send(body);
  });
}
