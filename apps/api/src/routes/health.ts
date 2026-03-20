import type { FastifyInstance } from 'fastify';

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
    // Placeholder for baseline data - will be backed by market_baselines table
    return reply.send({
      data: {
        baselines: [],
        message: 'Baseline analytics not yet populated. Run the baseline computation job first.',
      },
      meta: {},
    });
  });
}
