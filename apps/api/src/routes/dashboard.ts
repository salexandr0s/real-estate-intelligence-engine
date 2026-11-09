import type { FastifyInstance } from 'fastify';
import { dashboard, query } from '@immoradar/db';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/dashboard/stats', async (_request, reply) => {
    const stats = await dashboard.getStats();
    return reply.send(stats);
  });

  app.get('/v1/dashboard/velocity', async (_request, reply) => {
    // Days follow the Vienna calendar and come back as text, so neither the database session's
    // time zone nor the Mac's can move a listing to the day before.
    const rows = await query<{ day: string; count: string }>(
      `SELECT to_char((first_seen_at AT TIME ZONE 'Europe/Vienna')::date, 'YYYY-MM-DD') AS day,
              COUNT(*) AS count
       FROM listings
       WHERE listing_status = 'active'
         AND first_seen_at >= (((NOW() AT TIME ZONE 'Europe/Vienna')::date - 14)::timestamp
                               AT TIME ZONE 'Europe/Vienna')
       GROUP BY 1
       ORDER BY 1`,
      [],
    );

    return reply.send({
      data: rows.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
    });
  });
}
