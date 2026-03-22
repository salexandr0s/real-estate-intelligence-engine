import type { FastifyInstance } from 'fastify';
import { alerts } from '@rei/db';
import { createLogger } from '@rei/observability';

const logger = createLogger('api:stream');

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/stream/alerts',
    {
      schema: {
        tags: ['Streaming'],
        summary: 'Stream alerts via Server-Sent Events',
        description:
          'Long-lived SSE connection that pushes new alerts as they are matched. Sends keepalive comments every 30 seconds.',
      },
    },
    async (request, reply) => {
      reply.hijack();

      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const userId = request.userId;
      let lastChecked = new Date();

      // Poll for new alerts every 5 seconds
      const pollInterval = setInterval(async () => {
        if (res.destroyed) return;
        try {
          const newAlerts = await alerts.findSince(userId, lastChecked);
          for (const alert of newAlerts) {
            res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
          }
          if (newAlerts.length > 0) {
            // Advance cursor 1ms past the last alert to avoid re-delivery
            lastChecked = new Date(newAlerts[newAlerts.length - 1]!.matchedAt.getTime() + 1);
          }
        } catch (err) {
          if (!res.destroyed) {
            logger.error('SSE poll error', {
              errorClass: (err as Error).name,
              message: (err as Error).message,
            } as Record<string, unknown>);
          }
        }
      }, 5000);

      // Send keepalive every 30 seconds
      const keepaliveInterval = setInterval(() => {
        if (res.destroyed) return;
        try {
          res.write(': keepalive\n\n');
        } catch {
          // Connection already closed
        }
      }, 30000);

      // Cleanup on client disconnect
      request.raw.on('close', () => {
        clearInterval(pollInterval);
        clearInterval(keepaliveInterval);
        res.end();
      });

      // Send initial connection event
      res.write(
        `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
      );
    },
  );
}
