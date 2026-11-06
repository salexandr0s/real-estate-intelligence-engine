import { loadConfig } from '@immoradar/config';
import { getPool, closePool } from '@immoradar/db';
import { createLogger, runMain, setLogLevel } from '@immoradar/observability';
import type { LogLevel } from '@immoradar/observability';
import { buildApp } from './app.js';

const logger = createLogger('api');

// The engine watchdog sends SIGKILL at 5 s.
const HARD_TIMEOUT_MS = 4_000;
const APP_CLOSE_TIMEOUT_MS = 3_000;

runMain('api', HARD_TIMEOUT_MS, async (lifecycle) => {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

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

  lifecycle.onShutdown(
    'http server',
    async () => {
      await app.close();
      logger.info('API server closed');
    },
    APP_CLOSE_TIMEOUT_MS,
  );
  lifecycle.onShutdown('database pool', closePool);

  // Verify DB connection
  getPool();
  logger.info('Database pool initialized');

  // Start listening
  const address = await app.listen({
    host: config.api.host,
    port: config.api.port,
  });
  logger.info(`API server listening on ${address}`);
});
