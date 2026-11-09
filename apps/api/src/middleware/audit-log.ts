import type { FastifyInstance } from 'fastify';
import { createLogger } from '@immoradar/observability';

const auditLogger = createLogger('api:audit');

export function registerAuditLog(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url;
    if (route === '/health' || route === '/metrics') return;

    // Fastify times the request from its arrival, so a request the auth hook rejects before any
    // later hook runs still gets its real duration.
    const durationMs = reply.elapsedTime;
    const statusCode = reply.statusCode;

    const ctx = {
      userId: request.userId,
      method: request.method,
      route,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: request.ip,
    };

    if (statusCode < 400) {
      auditLogger.info('request', ctx);
    } else if (statusCode < 500) {
      auditLogger.warn('request', ctx);
    }
    // 5xx already logged by error handler
  });
}
