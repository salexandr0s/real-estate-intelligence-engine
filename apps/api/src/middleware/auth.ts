import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from '@rei/config';
import { UnauthorizedError } from '@rei/observability';

function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

const SKIP_AUTH_PATHS = new Set(['/health']);

export function registerAuth(app: FastifyInstance): void {
  const config = loadConfig();

  app.decorateRequest('userId', 0);

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Skip auth for health check and similar paths
    if (SKIP_AUTH_PATHS.has(request.url)) {
      request.userId = 0;
      return;
    }

    if (config.api.authMode === 'single_user_token') {
      const authHeader = request.headers.authorization;
      if (!authHeader) {
        throw new UnauthorizedError('Missing Authorization header');
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        throw new UnauthorizedError('Invalid Authorization header format. Expected: Bearer <token>');
      }

      const token = parts[1]!;
      if (!constantTimeEquals(token, config.api.bearerToken)) {
        throw new UnauthorizedError('Invalid bearer token');
      }

      // Single-user mode: always user id 1
      request.userId = 1;
      return;
    }

    // For future auth modes (OIDC, etc.), add handlers here
    throw new UnauthorizedError('Unsupported auth mode');
  });
}
