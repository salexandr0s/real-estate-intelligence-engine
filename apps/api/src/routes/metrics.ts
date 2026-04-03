import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadConfig } from '@immoradar/config';
import { registry } from '@immoradar/observability';
import { constantTimeEquals } from '../middleware/auth.js';

function getRemoteAddress(request: FastifyRequest): string {
  return request.ip || request.raw.socket.remoteAddress || '';
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    return isLoopbackAddress(normalized.slice(7));
  }

  const ipv4Parts = normalized.split('.').map(Number);
  return (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => !Number.isNaN(part)) &&
    ipv4Parts[0] === 127
  );
}

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  const metricsToken = config.observability.metricsToken;

  app.get('/metrics', async (request, reply) => {
    if (metricsToken) {
      const authHeader = request.headers.authorization ?? '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!bearer || !constantTimeEquals(bearer, metricsToken)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    } else if (!isLoopbackAddress(getRemoteAddress(request))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = await registry.metrics();
    return reply.type(registry.contentType).send(body);
  });
}
