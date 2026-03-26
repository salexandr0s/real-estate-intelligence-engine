// Register source adapters before any worker is created (canary needs them)
import './adapter-registry.js';

import { loadConfig } from '@immoradar/config';
import {
  createLogger,
  setLogLevel,
  redactUrl,
  initTracing,
  shutdownTracing,
} from '@immoradar/observability';
import type { LogLevel } from '@immoradar/observability';
import { closeRedisConnection } from '@immoradar/scraper-core';
import { closePool } from '@immoradar/db';
import { createIngestionWorker } from './workers/ingestion-worker.js';
import { createBaselineWorker } from './workers/baseline-worker.js';
import { createGeocodingWorker } from './workers/geocoding-worker.js';
import { createClusterWorker } from './workers/cluster-worker.js';
import { createGeocodingEnqueuer } from './workers/geocoding-enqueuer.js';
import { createStaleCheckWorker } from './workers/stale-check-worker.js';
import { createCanaryWorker } from './workers/canary-worker.js';
import { createDeliveryWorker } from './workers/delivery-worker.js';
import { createDocumentWorker } from './workers/document-worker.js';
import { closePushSession } from '@immoradar/alerts';
import { createMailboxSyncWorker } from './workers/mailbox-sync-worker.js';
import { createOutreachSendWorker } from './workers/outreach-send-worker.js';
import { mailboxes } from '@immoradar/db';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getQueuePrefix, getRedisConnection } from '@immoradar/scraper-core';
import type { MailboxSyncJobData } from '@immoradar/scraper-core';

const logger = createLogger('worker-processing');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);
  initTracing('immoradar-worker-processing');

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

  // Document processing worker
  const documentWorker = createDocumentWorker();
  const mailboxSyncWorker = config.outreach.enabled ? createMailboxSyncWorker() : null;
  const outreachSendWorker = config.outreach.enabled ? createOutreachSendWorker() : null;

  // Alert delivery worker — gated on any delivery channel being enabled
  const deliveryWorker =
    config.alerts.pushEnabled || config.alerts.emailEnabled || config.alerts.webhookEnabled
      ? createDeliveryWorker()
      : null;

  if (config.outreach.enabled && config.outreach.imap.user) {
    const mailbox = await mailboxes.ensureSharedMailbox({
      userId: 1,
      email: config.outreach.imap.user,
      displayName: config.outreach.fromName || null,
      secretRef: 'env:OUTREACH_SHARED_MAILBOX',
      pollIntervalSeconds: config.outreach.pollIntervalSeconds,
    });
    const queue = new Queue<MailboxSyncJobData>(QUEUE_NAMES.MAILBOX_SYNC, {
      connection: getRedisConnection() as ConnectionOptions,
      prefix: getQueuePrefix(),
    });
    await queue.add(
      `mailbox-sync:repeat:${mailbox.id}`,
      { mailboxAccountId: mailbox.id, triggeredBy: 'scheduler' },
      {
        jobId: `mailbox-sync:repeat:${mailbox.id}`,
        repeat: { every: config.outreach.pollIntervalSeconds * 1000 },
      },
    );
  }

  const workerNames = [
    'ingestion',
    'baseline',
    'cluster',
    'geocode-enqueue',
    'stale-check',
    'document',
  ];
  if (canaryWorker) workerNames.push('canary');
  if (geocodingWorker) workerNames.push('geocoding');
  if (deliveryWorker) workerNames.push('alert-delivery');
  if (mailboxSyncWorker) workerNames.push('mailbox-sync');
  if (outreachSendWorker) workerNames.push('outreach-send');
  logger.info(`Workers ready: ${workerNames.join(', ')}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down processing worker`);
    await ingestionWorker.close();
    await baselineWorker.close();
    await clusterWorker.close();
    await geocodingEnqueuer.close();
    await staleCheckWorker.close();
    await documentWorker.close();
    if (mailboxSyncWorker) await mailboxSyncWorker.close();
    if (outreachSendWorker) await outreachSendWorker.close();
    if (canaryWorker) await canaryWorker.close();
    if (geocodingWorker) await geocodingWorker.close();
    if (deliveryWorker) await deliveryWorker.close();
    await closePushSession();
    await shutdownTracing();
    await closeRedisConnection();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
