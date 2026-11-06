// Register source adapters before any worker is created (canary needs them)
import './adapter-registry.js';

import { loadConfig } from '@immoradar/config';
import { createLogger, runMain, setLogLevel, redactUrl } from '@immoradar/observability';
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

// The engine watchdog sends SIGKILL at 10 s.
const HARD_TIMEOUT_MS = 8_000;
// Worker.close() waits for running jobs with no limit, so shutdown moves on after this long.
const WORKER_CLOSE_GRACE_MS = 5_000;
const PUSH_SESSION_CLOSE_TIMEOUT_MS = 1_000;

runMain('worker-processing', HARD_TIMEOUT_MS, async (lifecycle) => {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

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
  const canaryWorker = config.scraper.canaryWorkerEnabled ? createCanaryWorker() : null;

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

  lifecycle.onShutdown(
    'workers',
    async () => {
      await Promise.all(
        [
          ingestionWorker,
          baselineWorker,
          clusterWorker,
          geocodingEnqueuer,
          staleCheckWorker,
          documentWorker,
          mailboxSyncWorker,
          outreachSendWorker,
          canaryWorker,
          geocodingWorker,
          deliveryWorker,
        ].map((worker) => worker?.close()),
      );
    },
    WORKER_CLOSE_GRACE_MS,
  );
  lifecycle.onShutdown('push session', closePushSession, PUSH_SESSION_CLOSE_TIMEOUT_MS);
  lifecycle.onShutdown('redis', closeRedisConnection);
  lifecycle.onShutdown('database pool', closePool);

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
});
