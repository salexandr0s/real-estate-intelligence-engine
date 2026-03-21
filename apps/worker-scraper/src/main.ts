import { loadConfig } from '@rei/config';
import { createLogger, setLogLevel } from '@rei/observability';
import type { LogLevel } from '@rei/observability';
import { closeRedisConnection } from '@rei/scraper-core';
import { closePool } from '@rei/db';
import { createDiscoveryWorker } from './workers/discovery-worker.js';
import { createDetailWorker } from './workers/detail-worker.js';
import { closeBrowser } from './browser-pool.js';
import { startScheduler } from './scheduler.js';

const logger = createLogger('worker-scraper');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info('Scraper worker starting', {
    nodeEnv: config.nodeEnv,
    redisUrl: config.redis.url,
  } as Record<string, unknown>);

  const discoveryWorker = createDiscoveryWorker();
  const detailWorker = createDetailWorker();

  logger.info('Discovery and detail workers ready');

  await startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down scraper worker`);
    await discoveryWorker.close();
    await detailWorker.close();
    await closeBrowser();
    await closeRedisConnection();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
