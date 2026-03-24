import type { FastifyInstance } from 'fastify';
import { alerts, subscribeToAlerts } from '@immoradar/db';
import type { AlertNotification } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';

const logger = createLogger('api:stream');

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/stream/alerts',
    {
      schema: {
        tags: ['Streaming'],
        summary: 'Stream alerts via Server-Sent Events',
        description:
          'Long-lived SSE connection that pushes new alerts in real-time via PG LISTEN/NOTIFY, with a 60-second fallback poll for robustness. Sends keepalive comments every 30 seconds.',
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

      // Helper: send alert events to the SSE stream
      const sendAlerts = async (newAlerts: Awaited<ReturnType<typeof alerts.findSince>>) => {
        for (const alert of newAlerts) {
          if (res.destroyed) return;
          res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
        }
        if (newAlerts.length > 0) {
          lastChecked = new Date(newAlerts[newAlerts.length - 1]!.matchedAt.getTime() + 1);
        }
      };

      // Real-time: subscribe to PG NOTIFY for instant delivery
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = await subscribeToAlerts((notification: AlertNotification) => {
          if (notification.userId !== userId) return;
          if (res.destroyed) return;

          // Fetch the full alert by ID and send it
          void alerts
            .findById(notification.alertId)
            .then((alert) => {
              if (alert && alert.channel === 'in_app' && !res.destroyed) {
                res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
                lastChecked = new Date(alert.matchedAt.getTime() + 1);
              }
            })
            .catch((err) => {
              if (!res.destroyed) {
                logger.error('Failed to fetch notified alert', {
                  alertId: notification.alertId,
                  error: (err as Error).message,
                });
              }
            });
        });
      } catch (err) {
        logger.warn('LISTEN/NOTIFY unavailable, falling back to polling only', {
          error: (err as Error).message,
        });
      }

      // Fallback poll every 60 seconds to catch any missed notifications
      const fallbackPollInterval = setInterval(async () => {
        if (res.destroyed) return;
        try {
          const allAlerts = await alerts.findSince(userId, lastChecked);
          const inAppAlerts = allAlerts.filter((a) => a.channel === 'in_app');
          await sendAlerts(inAppAlerts);
        } catch (err) {
          if (!res.destroyed) {
            logger.error('SSE fallback poll error', {
              errorClass: (err as Error).name,
              message: (err as Error).message,
            } as Record<string, unknown>);
          }
        }
      }, 60_000);

      // Send keepalive every 30 seconds
      const keepaliveInterval = setInterval(() => {
        if (res.destroyed) return;
        try {
          res.write(': keepalive\n\n');
        } catch {
          // Connection already closed
        }
      }, 30_000);

      // Cleanup on client disconnect
      request.raw.on('close', () => {
        clearInterval(fallbackPollInterval);
        clearInterval(keepaliveInterval);
        if (unsubscribe) unsubscribe();
        res.end();
      });

      // Send initial connection event
      res.write(
        `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
      );
    },
  );
}
