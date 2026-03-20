import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from '@rei/config';
import { getPool, closePool } from '@rei/db';
import { createLogger, setLogLevel } from '@rei/observability';
import type { LogLevel } from '@rei/observability';
import { registerAuth } from './middleware/auth.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { listingRoutes } from './routes/listings.js';
import { filterRoutes } from './routes/filters.js';
import { alertRoutes } from './routes/alerts.js';
import { sourceRoutes } from './routes/sources.js';

const logger = createLogger('api');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info('Starting API server', {
    nodeEnv: config.nodeEnv,
    host: config.api.host,
    port: config.api.port,
  } as Record<string, unknown>);

  const app = Fastify({
    logger: false, // We use our own structured logger
    trustProxy: true,
  });

  // Register CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Register error handler
  registerErrorHandler(app);

  // Register auth middleware
  registerAuth(app);

  // Register route modules
  await app.register(healthRoutes);
  await app.register(listingRoutes);
  await app.register(filterRoutes);
  await app.register(alertRoutes);
  await app.register(sourceRoutes);

  // Verify DB connection
  try {
    getPool();
    logger.info('Database pool initialized');
  } catch (err) {
    logger.error('Failed to connect to database', {
      errorClass: (err as Error).name,
      message: (err as Error).message,
    } as Record<string, unknown>);
    process.exit(1);
  }

  // Start listening
  try {
    const address = await app.listen({
      host: config.api.host,
      port: config.api.port,
    });
    logger.info(`API server listening on ${address}`);
  } catch (err) {
    logger.error('Failed to start API server', {
      errorClass: (err as Error).name,
      message: (err as Error).message,
    } as Record<string, unknown>);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    try {
      await app.close();
      await closePool();
      logger.info('API server closed');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', {
        errorClass: (err as Error).name,
        message: (err as Error).message,
      } as Record<string, unknown>);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

void main();
