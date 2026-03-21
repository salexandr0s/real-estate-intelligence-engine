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
}
