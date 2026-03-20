import type { FastifyInstance } from 'fastify';
import { query } from '@rei/db';

const APP_VERSION = process.env['npm_package_version'] ?? '0.1.0';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
    });
  });

  app.get('/v1/analytics/baselines', async (_request, reply) => {
    const rows = await query<Record<string, unknown>>(
      `SELECT city, district_no, operation_type, property_type,
              area_bucket, room_bucket, sample_size,
              median_ppsqm_eur, p25_ppsqm_eur, p75_ppsqm_eur,
              stddev_ppsqm_eur, baseline_date
       FROM market_baselines
       ORDER BY city, district_no NULLS LAST, area_bucket`,
      [],
    );
    return reply.send({ data: rows, meta: { count: rows.length } });
  });
}
