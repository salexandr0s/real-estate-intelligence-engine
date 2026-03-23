// Register source adapters before any worker is created (canary needs them)
import './adapter-registry.js';

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
import { createClusterWorker } from './workers/cluster-worker.js';
import { createGeocodingEnqueuer } from './workers/geocoding-enqueuer.js';
import { createStaleCheckWorker } from './workers/stale-check-worker.js';
import { createCanaryWorker } from './workers/canary-worker.js';
import { createDeliveryWorker } from './workers/delivery-worker.js';

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
  const clusterWorker = createClusterWorker();
  const geocodingEnqueuer = createGeocodingEnqueuer();
  const staleCheckWorker = createStaleCheckWorker();

  // Canary worker — gated on feature flag
  const canaryWorker = config.scraper.canaryEnabled ? createCanaryWorker() : null;

  // Geocoding worker — gated on feature flag
  const geocodingWorker = config.features.geocodingEnabled ? createGeocodingWorker() : null;

  // Alert delivery worker — gated on any delivery channel being enabled
  const deliveryWorker =
    config.alerts.pushEnabled || config.alerts.emailEnabled || config.alerts.webhookEnabled
      ? createDeliveryWorker()
      : null;

  const workerNames = ['ingestion', 'baseline', 'cluster', 'geocode-enqueue', 'stale-check'];
  if (canaryWorker) workerNames.push('canary');
  if (geocodingWorker) workerNames.push('geocoding');
  if (deliveryWorker) workerNames.push('alert-delivery');
  logger.info(`Workers ready: ${workerNames.join(', ')}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down processing worker`);
    await ingestionWorker.close();
    await baselineWorker.close();
    await clusterWorker.close();
    await geocodingEnqueuer.close();
    await staleCheckWorker.close();
    if (canaryWorker) await canaryWorker.close();
    if (geocodingWorker) await geocodingWorker.close();
    if (deliveryWorker) await deliveryWorker.close();
    await shutdownTracing();
    await closeRedisConnection();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
