import type { FastifyInstance } from 'fastify';
import { dashboard, query } from '@rei/db';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/dashboard/stats', async (_request, reply) => {
    const stats = await dashboard.getStats();
    return reply.send(stats);
  });

  app.get('/v1/dashboard/velocity', async (_request, reply) => {
    const rows = await query<{ day: Date; count: string }>(
      `SELECT date_trunc('day', first_seen_at)::date AS day,
              COUNT(*) AS count
       FROM listings
       WHERE listing_status = 'active'
         AND first_seen_at >= CURRENT_DATE - INTERVAL '14 days'
       GROUP BY 1
       ORDER BY 1`,
      [],
    );

    return reply.send({
      data: rows.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        count: Number(r.count),
      })),
    });
  });
}
