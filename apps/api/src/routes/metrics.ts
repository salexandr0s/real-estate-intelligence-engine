import type { FastifyInstance } from 'fastify';
import { registry } from '@rei/observability';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  const metricsToken = process.env.METRICS_TOKEN ?? null;

  app.get('/metrics', async (request, reply) => {
    // When METRICS_TOKEN is set, require it as a query param or Bearer token
    if (metricsToken) {
      const query = request.query as Record<string, string>;
      const authHeader = request.headers.authorization ?? '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (query.token !== metricsToken && bearer !== metricsToken) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    }

    const body = await registry.metrics();
    return reply.type(registry.contentType).send(body);
  });
}
