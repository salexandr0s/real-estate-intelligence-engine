import { loadConfig } from '@rei/config';
import { getPool, closePool } from '@rei/db';
import { createLogger, setLogLevel, initTracing, shutdownTracing } from '@rei/observability';
import type { LogLevel } from '@rei/observability';
import { buildApp } from './app.js';

const logger = createLogger('api');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);
  initTracing('rei-api');

  logger.info('Starting API server', {
    nodeEnv: config.nodeEnv,
    host: config.api.host,
    port: config.api.port,
  } as Record<string, unknown>);

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
