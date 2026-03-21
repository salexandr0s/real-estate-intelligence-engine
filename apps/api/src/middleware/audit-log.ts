import type { FastifyInstance } from 'fastify';
import { createLogger } from '@rei/observability';

declare module 'fastify' {
  interface FastifyRequest {
    startTime: bigint;
  }
}

const auditLogger = createLogger('api:audit');

export function registerAuditLog(app: FastifyInstance): void {
  app.decorateRequest('startTime', BigInt(0));

  app.addHook('onRequest', async (request) => {
    request.startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url;
    if (route === '/health') return;

    const durationMs = Number(process.hrtime.bigint() - request.startTime) / 1_000_000;
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
