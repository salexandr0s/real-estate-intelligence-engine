import { loadConfig } from '@immoradar/config';
import { getPool, closePool } from '@immoradar/db';
import { createLogger, setLogLevel, initTracing, shutdownTracing } from '@immoradar/observability';
import type { LogLevel } from '@immoradar/observability';
import { buildApp } from './app.js';

const logger = createLogger('api');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);
  initTracing('immoradar-api');

  logger.info('Starting API server', {
    nodeEnv: config.nodeEnv,
    host: config.api.host,
    port: config.api.port,
  } as Record<string, unknown>);

  if (config.nodeEnv === 'production' && config.api.trustProxy !== false) {
    logger.warn('API trustProxy is enabled in production', {
      trustProxy: config.api.trustProxy,
    } as Record<string, unknown>);
  }

  if (config.nodeEnv === 'production' && config.api.docsPublic) {
    logger.warn('API docs are public in production via explicit override');
  }

  const app = await buildApp();

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
      await shutdownTracing();
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

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

void main();
