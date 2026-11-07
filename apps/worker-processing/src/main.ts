import { loadConfig } from '@immoradar/config';
import { createLogger, runMain, setLogLevel, redactUrl } from '@immoradar/observability';
import type { LogLevel } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  closeRedisConnection,
  createQueue,
  shouldRegisterAutomatedSchedules,
} from '@immoradar/scraper-core';
import type { MailboxSyncJobData } from '@immoradar/scraper-core';
import { closePool, mailboxes } from '@immoradar/db';
import { createIngestionWorker } from './workers/ingestion-worker.js';
import { createBaselineWorker } from './workers/baseline-worker.js';
import { createClusterWorker } from './workers/cluster-worker.js';
import { createStaleCheckWorker } from './workers/stale-check-worker.js';

const logger = createLogger('worker-processing');

// The engine watchdog sends SIGKILL at 10 s.
const HARD_TIMEOUT_MS = 8_000;
// Worker.close() waits for running jobs with no limit, so shutdown moves on after this long.
const WORKER_CLOSE_GRACE_MS = 5_000;
const PUSH_SESSION_CLOSE_TIMEOUT_MS = 1_000;

interface Closable {
  close(): Promise<void>;
}

async function scheduleMailboxSync(
  mailboxAccountId: number,
  pollIntervalSeconds: number,
): Promise<void> {
  const queue = createQueue<MailboxSyncJobData>(QUEUE_NAMES.MAILBOX_SYNC);
  await queue.upsertJobScheduler(
    `mailbox-sync-repeat-${mailboxAccountId}`,
    { every: pollIntervalSeconds * 1000 },
    { name: 'mailbox-sync', data: { mailboxAccountId, triggeredBy: 'scheduler' } },
  );
  await queue.close();
}

runMain('worker-processing', HARD_TIMEOUT_MS, async (lifecycle) => {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info('Processing worker starting', {
    nodeEnv: config.nodeEnv,
    redisUrl: redactUrl(config.redis.url),
  } as Record<string, unknown>);

  const workers = new Map<string, Closable>();

  lifecycle.onShutdown(
    'workers',
    async () => {
      await Promise.all([...workers.values()].map((worker) => worker.close()));
    },
    WORKER_CLOSE_GRACE_MS,
  );

  workers.set('ingestion', createIngestionWorker());
  workers.set('baseline', createBaselineWorker());
  workers.set('cluster', createClusterWorker());
  workers.set('stale-check', createStaleCheckWorker());

  // Optional workers load on demand, so a feature that is off costs no memory. Canary pulls in
  // Playwright and every adapter, documents the PDF parser, outreach and delivery the mail libraries.
  if (config.features.geocodingEnabled) {
    const { createGeocodingEnqueuer } = await import('./workers/geocoding-enqueuer.js');
    const { createGeocodingWorker } = await import('./workers/geocoding-worker.js');
    workers.set('geocode-enqueue', createGeocodingEnqueuer());
    workers.set('geocoding', createGeocodingWorker());
  }

  if (config.scraper.canaryWorkerEnabled) {
    await import('./adapter-registry.js');
    const { createCanaryWorker } = await import('./workers/canary-worker.js');
    workers.set('canary', createCanaryWorker());
  }

  if (config.features.documentsEnabled) {
    const { createDocumentWorker } = await import('./workers/document-worker.js');
    workers.set('document', createDocumentWorker());
  }

  if (config.outreach.enabled) {
    const { createMailboxSyncWorker } = await import('./workers/mailbox-sync-worker.js');
    const { createOutreachSendWorker } = await import('./workers/outreach-send-worker.js');
    workers.set('mailbox-sync', createMailboxSyncWorker());
    workers.set('outreach-send', createOutreachSendWorker());
  }

  if (config.alerts.pushEnabled || config.alerts.emailEnabled || config.alerts.webhookEnabled) {
    const { createDeliveryWorker } = await import('./workers/delivery-worker.js');
    const { closePushSession } = await import('@immoradar/alerts');
    workers.set('alert-delivery', createDeliveryWorker());
    lifecycle.onShutdown('push session', closePushSession, PUSH_SESSION_CLOSE_TIMEOUT_MS);
  }

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
    if (shouldRegisterAutomatedSchedules(config)) {
      await scheduleMailboxSync(mailbox.id, config.outreach.pollIntervalSeconds);
    }
  }

  logger.info(`Workers ready: ${[...workers.keys()].join(', ')}`);
});
