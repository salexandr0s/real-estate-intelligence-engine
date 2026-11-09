import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { loadConfig } from '@immoradar/config';
import { API_ERROR_CODES } from '@immoradar/contracts';
import { AppError, apiRequestDuration } from '@immoradar/observability';
import { registerAuth } from './middleware/auth.js';
import { registerAuditLog } from './middleware/audit-log.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { listingRoutes } from './routes/listings.js';
import { filterRoutes } from './routes/filters.js';
import { alertRoutes } from './routes/alerts.js';
import { sourceRoutes } from './routes/sources.js';
import { analyticsRoutes } from './routes/analytics.js';
import { metricsRoutes } from './routes/metrics.js';
import { streamRoutes } from './routes/stream.js';
import { poiRoutes } from './routes/pois.js';
import { savedListingRoutes } from './routes/saved-listings.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { copilotRoutes } from './routes/copilot.js';
import { deviceRoutes } from './routes/devices.js';
import { analysisRoutes } from './routes/analysis.js';
import { documentRoutes } from './routes/documents.js';
import { legalRentRoutes } from './routes/legal-rent.js';
import { mailboxRoutes } from './routes/mailboxes.js';
import { outreachRoutes } from './routes/outreach.js';

/**
 * Clients on this machine, the macOS app among them, are never rate limited. Behind a reverse
 * proxy on the same host every request arrives from loopback, so set API_TRUST_PROXY to the
 * proxy's address there, or no client is limited at all.
 */
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/**
 * The macOS app sends `Content-Type: application/json` on every non-GET request, with or without
 * a body, and Fastify's parser answers an empty body with 400. Here an empty body counts as no
 * body. Anything else goes to the default parser, which keeps its prototype-poisoning checks.
 */
function acceptEmptyJsonBody(app: FastifyInstance): void {
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser<string>(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      if (body === '') {
        done(null, undefined);
        return;
      }
      return parseJson(request, body, done);
    },
  );
}

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: false,
    trustProxy: config.api.trustProxy,
    // An open SSE stream would otherwise hold app.close() open.
    forceCloseConnections: true,
  });

  acceptEmptyJsonBody(app);

  // Before any plugin adds routes: a route keeps the error handler that was set when it was added,
  // so /docs would otherwise answer errors in Fastify's own format instead of the envelope.
  registerErrorHandler(app);

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  });

  // CORS
  await app.register(cors, {
    origin: config.api.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Copilot-Api-Key'],
    credentials: false,
  });

  // Rate limiting. The app makes several requests for each listing it opens, so loopback clients
  // skip the limit. /health opts out on its route.
  await app.register(rateLimit, {
    max: config.api.rateLimitMax,
    timeWindow: config.api.rateLimitWindowMs,
    allowList: LOOPBACK_ADDRESSES,
    // The plugin throws what this returns, so it carries the status for the error handler.
    errorResponseBuilder: (_request, context) =>
      new AppError(
        `Too many requests. Try again in ${context.after}.`,
        API_ERROR_CODES.RATE_LIMITED,
        context.statusCode,
      ),
  });

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ImmoRadar API',
        version: '1.0.0',
        description: 'Austrian property intelligence platform API',
      },
      servers: [{ url: config.api.baseUrl }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Auth middleware
  registerAuth(app);

  // Audit logging (after auth so userId is available)
  registerAuditLog(app);

  // Route modules
  await app.register(healthRoutes);
  await app.register(listingRoutes);
  await app.register(filterRoutes);
  await app.register(alertRoutes);
  await app.register(sourceRoutes);
  await app.register(analyticsRoutes);
  if (config.observability.prometheusEnabled) {
    await app.register(metricsRoutes);
  }
  await app.register(streamRoutes);
  await app.register(poiRoutes);
  await app.register(savedListingRoutes);
  await app.register(dashboardRoutes);
  await app.register(copilotRoutes);
  await app.register(deviceRoutes);
  await app.register(analysisRoutes);
  await app.register(documentRoutes);
  await app.register(legalRentRoutes);
  await app.register(mailboxRoutes);
  await app.register(outreachRoutes);

  // API request duration metrics
  app.addHook('onResponse', (_request, reply, done) => {
    const duration = reply.elapsedTime / 1000;
    apiRequestDuration.observe(
      {
        method: _request.method,
        route: _request.routeOptions?.url ?? _request.url,
        status_code: String(reply.statusCode),
      },
      duration,
    );
    done();
  });

  return app;
}
