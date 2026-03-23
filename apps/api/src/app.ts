import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { loadConfig } from '@rei/config';
import { apiRequestDuration } from '@rei/observability';
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
import { feedbackRoutes } from './routes/feedback.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { copilotRoutes } from './routes/copilot.js';
import { deviceRoutes } from './routes/devices.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: false,
    trustProxy: config.api.trustProxy,
  });

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
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.api.rateLimitMax,
    timeWindow: config.api.rateLimitWindowMs,
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'rate_limited',
        message: `Rate limit exceeded. Retry after ${context.after}`,
      },
    }),
  });

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Real Estate Intelligence Engine API',
        version: '1.0.0',
        description: 'Austrian real estate intelligence platform API',
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

  // Error handler
  registerErrorHandler(app);

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
  await app.register(metricsRoutes);
  await app.register(streamRoutes);
  await app.register(poiRoutes);
  await app.register(savedListingRoutes);
  await app.register(feedbackRoutes);
  await app.register(dashboardRoutes);
  await app.register(copilotRoutes);
  await app.register(deviceRoutes);

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
