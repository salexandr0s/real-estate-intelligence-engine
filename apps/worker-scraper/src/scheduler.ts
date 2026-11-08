/**
 * Registers the BullMQ schedules for scraping and pipeline tasks.
 *
 * Schedules persist in Redis, so a missed run is recovered after a crash. It also means each start
 * has to remove whatever the current config no longer wants.
 */

import { createLogger } from '@immoradar/observability';
import { loadConfig } from '@immoradar/config';
import {
  QUEUE_NAMES,
  createQueue,
  discoverySchedulerId,
  hourlyCron,
  removeSchedulersExcept,
  shouldRegisterAutomatedSchedules,
  syncDiscoverySchedule,
} from '@immoradar/scraper-core';
import type {
  DiscoveryJobData,
  BaselineJobData,
  ClusterJobData,
  GeocodeEnqueueJobData,
  StaleCheckJobData,
  CanaryJobData,
  MailboxSyncJobData,
} from '@immoradar/scraper-core';
import { sources, scrapeRuns } from '@immoradar/db';

const log = createLogger('scheduler');

const SCHEDULER_IDS = {
  baseline: 'baseline-periodic',
  cluster: 'cluster-daily',
  geocode: 'geocode-enqueue-periodic',
  staleCheck: 'stale-check-periodic',
  canary: 'canary-periodic',
} as const;

const GEOCODE_BATCH_SIZE = 30;

export async function startScheduler(): Promise<void> {
  const config = loadConfig();

  const discoveryQueue = createQueue<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY);
  const baselineQueue = createQueue<BaselineJobData>(QUEUE_NAMES.BASELINE);
  const clusterQueue = createQueue<ClusterJobData>(QUEUE_NAMES.CLUSTER);
  const geocodeEnqueueQueue = createQueue<GeocodeEnqueueJobData>(QUEUE_NAMES.GEOCODE_ENQUEUE);
  const staleCheckQueue = createQueue<StaleCheckJobData>(QUEUE_NAMES.STALE_CHECK);
  const canaryQueue = createQueue<CanaryJobData>(QUEUE_NAMES.CANARY);
  // The processing worker owns the mailbox schedule, and this clears it when schedules are off.
  const mailboxQueue = createQueue<MailboxSyncJobData>(QUEUE_NAMES.MAILBOX_SYNC);

  const allQueues = [
    discoveryQueue,
    baselineQueue,
    clusterQueue,
    geocodeEnqueueQueue,
    staleCheckQueue,
    canaryQueue,
    mailboxQueue,
  ];

  try {
    const zombieCancelled = await scrapeRuns.cancelZombieRuns(
      config.scheduler.zombieRunTimeoutMinutes,
    );
    if (zombieCancelled > 0) {
      log.warn('Cancelled zombie scrape runs', { count: zombieCancelled });
    }

    if (!shouldRegisterAutomatedSchedules(config)) {
      await Promise.all(allQueues.map((queue) => removeSchedulersExcept(queue, [])));
      log.info('Automated schedules cleared', {
        bootMode: config.runtime.bootMode,
        schedulerEnabled: config.scheduler.enabled,
      });
      return;
    }

    const geocodingOn = config.features.geocodingEnabled;
    const canaryOn = config.scraper.canaryWorkerEnabled;

    await Promise.all([
      removeSchedulersExcept(baselineQueue, [SCHEDULER_IDS.baseline]),
      removeSchedulersExcept(clusterQueue, [SCHEDULER_IDS.cluster]),
      removeSchedulersExcept(staleCheckQueue, [SCHEDULER_IDS.staleCheck]),
      removeSchedulersExcept(geocodeEnqueueQueue, geocodingOn ? [SCHEDULER_IDS.geocode] : []),
      removeSchedulersExcept(canaryQueue, canaryOn ? [SCHEDULER_IDS.canary] : []),
    ]);

    await baselineQueue.upsertJobScheduler(
      SCHEDULER_IDS.baseline,
      { pattern: hourlyCron(SCHEDULER_IDS.baseline, 6) },
      { name: 'baseline:recompute', data: { triggeredBy: 'scheduler' } },
    );

    await clusterQueue.upsertJobScheduler(
      SCHEDULER_IDS.cluster,
      { pattern: '20 3 * * *' },
      { name: 'cluster:rebuild', data: { triggeredBy: 'scheduler' } },
    );

    await staleCheckQueue.upsertJobScheduler(
      SCHEDULER_IDS.staleCheck,
      { pattern: hourlyCron(SCHEDULER_IDS.staleCheck, 6) },
      {
        name: 'stale:check',
        data: { triggeredBy: 'scheduler', thresholdDays: config.scheduler.staleThresholdDays },
      },
    );

    if (geocodingOn) {
      await geocodeEnqueueQueue.upsertJobScheduler(
        SCHEDULER_IDS.geocode,
        { pattern: hourlyCron(SCHEDULER_IDS.geocode, 1) },
        {
          name: 'geocode:enqueue',
          data: { triggeredBy: 'scheduler', limit: GEOCODE_BATCH_SIZE },
        },
      );
    }

    if (canaryOn) {
      await canaryQueue.upsertJobScheduler(
        SCHEDULER_IDS.canary,
        { pattern: hourlyCron(SCHEDULER_IDS.canary, 2) },
        { name: 'canary:check', data: { triggeredBy: 'scheduler' } },
      );
    }

    const allSources = await sources.findAll();
    await Promise.all(
      allSources.map((source) => syncDiscoverySchedule(discoveryQueue, source, config)),
    );
    await removeSchedulersExcept(
      discoveryQueue,
      allSources.map((source) => discoverySchedulerId(source.code)),
    );

    log.info('Schedules registered', {
      geocodingOn,
      canaryOn,
      minCrawlIntervalMinutes: config.scraper.minCrawlIntervalMinutes,
      activeSources: allSources.filter((source) => source.isActive).map((source) => source.code),
    });
  } finally {
    await Promise.all(allQueues.map((queue) => queue.close()));
  }
}
