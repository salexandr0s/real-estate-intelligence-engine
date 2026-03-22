import type { FastifyInstance } from 'fastify';
import { dashboard } from '@rei/db';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/dashboard/stats', async (_request, reply) => {
    const stats = await dashboard.getStats();
    return reply.send(stats);
  });
}
