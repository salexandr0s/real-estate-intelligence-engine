import { loadConfig } from '@rei/config';
import {
  createLogger,
  setLogLevel,
  redactUrl,
  initTracing,
  shutdownTracing,
} from '@rei/observability';
import type { LogLevel } from '@rei/observability';
import { closeRedisConnection } from '@rei/scraper-core';
import { closePool } from '@rei/db';
import { createIngestionWorker } from './workers/ingestion-worker.js';
import { createBaselineWorker } from './workers/baseline-worker.js';
import { createGeocodingWorker } from './workers/geocoding-worker.js';

const logger = createLogger('worker-processing');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);
  initTracing('rei-worker-processing');

  logger.info('Processing worker starting', {
    nodeEnv: config.nodeEnv,
    redisUrl: redactUrl(config.redis.url),
  } as Record<string, unknown>);

  const ingestionWorker = createIngestionWorker();
  const baselineWorker = createBaselineWorker();

  // Geocoding worker — gated on feature flag
  const geocodingWorker = config.features.geocodingEnabled ? createGeocodingWorker() : null;

  const workerNames = ['ingestion', 'baseline'];
  if (geocodingWorker) workerNames.push('geocoding');
  logger.info(`Workers ready: ${workerNames.join(', ')}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down processing worker`);
    await ingestionWorker.close();
    await baselineWorker.close();
    if (geocodingWorker) await geocodingWorker.close();
    await shutdownTracing();
    await closeRedisConnection();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
