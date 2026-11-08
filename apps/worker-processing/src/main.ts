import { loadConfig } from '@immoradar/config';
import type { AppConfig } from '@immoradar/config';
import { createLogger, runMain, setLogLevel, redactUrl } from '@immoradar/observability';
import type { LogLevel } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  closeRedisConnection,
  createQueue,
  removeSchedulersExcept,
  shouldRegisterAutomatedSchedules,
} from '@immoradar/scraper-core';
import type { BaselineJobData, MailboxSyncJobData } from '@immoradar/scraper-core';
import { closePool, mailboxes, marketBaselines } from '@immoradar/db';
import { createIngestionWorker } from './workers/ingestion-worker.js';
import { createBaselineWorker } from './workers/baseline-worker.js';
import { createClusterWorker } from './workers/cluster-worker.js';
import { createRescoreWorker } from './workers/rescore-worker.js';
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

/**
 * Loads one optional feature's modules, then runs the returned function to create its workers.
 * Nothing is created once shutdown has begun, because the workers step may already have closed the
 * ones that exist. A failure is logged with the feature name and the other workers keep running.
 */
async function startOptionalWorkers(
  feature: string,
  shutdownSignal: AbortSignal,
  load: () => Promise<() => void>,
): Promise<void> {
  try {
    const start = await load();
    if (!shutdownSignal.aborted) start();
  } catch (err) {
    logger.error(`The ${feature} workers failed to start, so the service runs without them`, {
      feature,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Leaves the mailbox queue with one scheduler, for the shared mailbox, when outreach and automated
 * schedules are both on, and with none otherwise. Every other entry is removed, including a
 * repeatable job left over under the old `mailbox-sync:repeat:<id>` name.
 */
async function syncMailboxSchedule(config: AppConfig): Promise<void> {
  let mailboxAccountId: number | null = null;
  if (config.outreach.enabled && config.outreach.imap.user) {
    const mailbox = await mailboxes.ensureSharedMailbox({
      userId: 1,
      email: config.outreach.imap.user,
      displayName: config.outreach.fromName || null,
      secretRef: 'env:OUTREACH_SHARED_MAILBOX',
      pollIntervalSeconds: config.outreach.pollIntervalSeconds,
    });
    mailboxAccountId = mailbox.id;
  }

  const queue = createQueue<MailboxSyncJobData>(QUEUE_NAMES.MAILBOX_SYNC);
  try {
    if (mailboxAccountId === null || !shouldRegisterAutomatedSchedules(config)) {
      await removeSchedulersExcept(queue, []);
      return;
    }
    const schedulerId = `mailbox-sync-repeat-${mailboxAccountId}`;
    await removeSchedulersExcept(queue, [schedulerId]);
    await queue.upsertJobScheduler(
      schedulerId,
      { every: config.outreach.pollIntervalSeconds * 1000 },
      { name: 'mailbox-sync', data: { mailboxAccountId, triggeredBy: 'scheduler' } },
    );
  } finally {
    await queue.close();
  }
}

const VIENNA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** node-postgres parses a DATE column as local midnight, so the local getters give back the stored day. */
function storedDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The scheduler runs baselines every 6 hours, but only while the app is open, so a day with the app
 * closed leaves no baseline for today. This queues one run when the newest baseline is from before
 * today in Vienna. It is part of the automated schedule, so it stays off when that is off.
 */
async function queueBaselineIfStale(config: AppConfig): Promise<void> {
  if (!shouldRegisterAutomatedSchedules(config)) return;

  const today = VIENNA_DATE.format(new Date());
  const latest = await marketBaselines.findLatestBaselineDate();
  if (latest && storedDay(latest) >= today) return;

  const queue = createQueue<BaselineJobData>(QUEUE_NAMES.BASELINE);
  try {
    // One id per day, so a restart while the run still waits doesn't queue a second one.
    await queue.add(
      'baseline:recompute',
      { triggeredBy: 'scheduler' },
      { jobId: `baseline-boot-${today}` },
    );
    logger.info('Queued a baseline run because the newest baseline is from before today', {
      latestBaselineDate: latest ? storedDay(latest) : null,
    });
  } finally {
    await queue.close();
  }
}

runMain('worker-processing', HARD_TIMEOUT_MS, async (lifecycle) => {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info('Processing worker starting', {
    nodeEnv: config.nodeEnv,
    redisUrl: redactUrl(config.redis.url),
  } as Record<string, unknown>);

  const workers = new Map<string, Closable>();
  const deliveryEnabled =
    config.alerts.pushEnabled || config.alerts.emailEnabled || config.alerts.webhookEnabled;
  let closePushSession: (() => Promise<void>) | undefined;

  // Steps run in registration order: the workers, then the push session, Redis and the pool. All of
  // them are registered before the first await, so a signal that arrives while an optional module
  // loads still runs every step.
  lifecycle.onShutdown(
    'workers',
    async () => {
      await Promise.all([...workers.values()].map((worker) => worker.close()));
    },
    WORKER_CLOSE_GRACE_MS,
  );
  if (deliveryEnabled) {
    lifecycle.onShutdown(
      'push session',
      async () => {
        await closePushSession?.();
      },
      PUSH_SESSION_CLOSE_TIMEOUT_MS,
    );
  }
  lifecycle.onShutdown('redis', closeRedisConnection);
  lifecycle.onShutdown('database pool', closePool);

  workers.set('ingestion', createIngestionWorker());
  workers.set('baseline', createBaselineWorker());
  workers.set('cluster', createClusterWorker());
  workers.set('rescore', createRescoreWorker());
  workers.set('stale-check', createStaleCheckWorker());

  // Optional workers load on demand, so a feature that is off costs no memory. Canary pulls in
  // Playwright and every adapter, documents the PDF parser, outreach and delivery the mail libraries.
  if (config.features.geocodingEnabled) {
    await startOptionalWorkers('geocoding', lifecycle.shutdownSignal, async () => {
      const { createGeocodingEnqueuer } = await import('./workers/geocoding-enqueuer.js');
      const { createGeocodingWorker } = await import('./workers/geocoding-worker.js');
      return () => {
        workers.set('geocode-enqueue', createGeocodingEnqueuer());
        workers.set('geocoding', createGeocodingWorker());
      };
    });
  }

  if (config.scraper.canaryWorkerEnabled) {
    await startOptionalWorkers('canary', lifecycle.shutdownSignal, async () => {
      await import('./adapter-registry.js');
      const { createCanaryWorker } = await import('./workers/canary-worker.js');
      return () => {
        workers.set('canary', createCanaryWorker());
      };
    });
  }

  if (config.features.documentsEnabled) {
    await startOptionalWorkers('document', lifecycle.shutdownSignal, async () => {
      const { createDocumentWorker } = await import('./workers/document-worker.js');
      return () => {
        workers.set('document', createDocumentWorker());
      };
    });
  }

  if (config.outreach.enabled) {
    await startOptionalWorkers('outreach', lifecycle.shutdownSignal, async () => {
      const { createMailboxSyncWorker } = await import('./workers/mailbox-sync-worker.js');
      const { createOutreachSendWorker } = await import('./workers/outreach-send-worker.js');
      return () => {
        workers.set('mailbox-sync', createMailboxSyncWorker());
        workers.set('outreach-send', createOutreachSendWorker());
      };
    });
  }

  if (deliveryEnabled) {
    await startOptionalWorkers('alert delivery', lifecycle.shutdownSignal, async () => {
      const { createDeliveryWorker } = await import('./workers/delivery-worker.js');
      const alerts = await import('@immoradar/alerts');
      return () => {
        closePushSession = alerts.closePushSession;
        workers.set('alert-delivery', createDeliveryWorker());
      };
    });
  }

  // After shutdown begins the redis step may already have run, and a new queue would open a
  // connection that nothing closes.
  if (lifecycle.shutdownSignal.aborted) return;
  try {
    await syncMailboxSchedule(config);
  } catch (err) {
    // The workers keep running, and the next start syncs the schedule again.
    logger.error('Could not sync the mailbox schedule', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (lifecycle.shutdownSignal.aborted) return;
  try {
    await queueBaselineIfStale(config);
  } catch (err) {
    // Scoring keeps the older baselines, and the 6-hourly schedule computes new ones.
    logger.error('Could not queue the boot baseline run', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info(`Workers ready: ${[...workers.keys()].join(', ')}`);
});
