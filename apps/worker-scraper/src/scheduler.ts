/**
 * Scheduler: registers BullMQ repeatable jobs for scraping and pipeline tasks.
 *
 * All scheduling is done via BullMQ's upsertJobScheduler(), which persists
 * schedules in Redis. This means missed jobs are recovered after a crash —
 * unlike the previous setInterval approach which stopped on process exit.
 */

import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createLogger } from '@rei/observability';
import { loadConfig } from '@rei/config';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
  DEFAULT_JOB_RETRY_OPTS,
} from '@rei/scraper-core';
import type {
  DiscoveryJobData,
  BaselineJobData,
  ClusterJobData,
  GeocodeEnqueueJobData,
  StaleCheckJobData,
  CanaryJobData,
} from '@rei/scraper-core';
import { sources, scrapeRuns } from '@rei/db';

const log = createLogger('scheduler');

/**
 * Convert crawlIntervalMinutes to a cron pattern.
 * BullMQ repeatable jobs need a cron string or an `every` ms interval.
 * We use `every` for sub-hourly intervals and cron for hourly+.
 */
function intervalToCron(minutes: number): string {
  if (minutes <= 0) return '*/30 * * * *'; // safety fallback
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.round(minutes / 60);
  if (hours >= 24) return '0 0 * * *'; // daily at midnight for 24h+ intervals
  return `0 */${hours} * * *`;
}

export async function startScheduler(): Promise<void> {
  const config = loadConfig();
  if (!config.scheduler.enabled) {
    log.info('Scheduler disabled via config');
    return;
  }

  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const discoveryQueue = new Queue<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY, {
    connection,
    prefix,
  });

  const baselineQueue = new Queue<BaselineJobData>(QUEUE_NAMES.BASELINE, {
    connection,
    prefix,
  });

  const clusterQueue = new Queue<ClusterJobData>(QUEUE_NAMES.CLUSTER, {
    connection,
    prefix,
  });

  const geocodeEnqueueQueue = new Queue<GeocodeEnqueueJobData>(QUEUE_NAMES.GEOCODE_ENQUEUE, {
    connection,
    prefix,
  });

  const staleCheckQueue = new Queue<StaleCheckJobData>(QUEUE_NAMES.STALE_CHECK, {
    connection,
    prefix,
  });

  const canaryQueue = new Queue<CanaryJobData>(QUEUE_NAMES.CANARY, {
    connection,
    prefix,
  });

  // ── Cancel zombie runs from previous crashes ───────────────────────────────

  const zombieCancelled = await scrapeRuns.cancelZombieRuns(
    config.scheduler.zombieRunTimeoutMinutes,
  );
  if (zombieCancelled > 0) {
    log.warn('Cancelled zombie scrape runs', { count: zombieCancelled });
  }

  // ── Pipeline infrastructure schedules ──────────────────────────────────────

  // Baseline recomputation every hour
  await baselineQueue.upsertJobScheduler(
    'baseline-hourly',
    { pattern: '0 * * * *' },
    {
      name: 'baseline:recompute',
      data: { triggeredBy: 'scheduler' },
    },
  );
  log.info('Baseline scheduler registered (hourly)');

  // Cluster rebuild daily at 03:00
  await clusterQueue.upsertJobScheduler(
    'cluster-daily',
    { pattern: '0 3 * * *' },
    {
      name: 'cluster:rebuild',
      data: { triggeredBy: 'scheduler' },
    },
  );
  log.info('Cluster scheduler registered (daily 03:00)');

  // Geocoding enqueue every 30 minutes
  await geocodeEnqueueQueue.upsertJobScheduler(
    'geocode-enqueue-periodic',
    { pattern: '*/30 * * * *' },
    {
      name: 'geocode:enqueue',
      data: { triggeredBy: 'scheduler', limit: 50 },
    },
  );
  log.info('Geocode enqueue scheduler registered (every 30 min)');

  // Stale listing detection every 6 hours
  await staleCheckQueue.upsertJobScheduler(
    'stale-check-periodic',
    { pattern: '0 */6 * * *' },
    {
      name: 'stale:check',
      data: {
        triggeredBy: 'scheduler',
        thresholdDays: config.scheduler.staleThresholdDays,
      },
    },
  );
  log.info('Stale check scheduler registered (every 6 hours)');

  // Canary health check every 2 hours (if enabled)
  if (config.scraper.canaryEnabled) {
    await canaryQueue.upsertJobScheduler(
      'canary-periodic',
      { pattern: '0 */2 * * *' },
      {
        name: 'canary:check',
        data: { triggeredBy: 'scheduler' },
      },
    );
    log.info('Canary scheduler registered (every 2 hours)');
  }

  // ── Per-source discovery schedules ─────────────────────────────────────────

  const activeSources = await sources.findActive();
  log.info(`Registering discovery schedules for ${activeSources.length} source(s)`);

  for (const source of activeSources) {
    const crawlMinutes = source.crawlIntervalMinutes ?? 30;
    const cronPattern = intervalToCron(crawlMinutes);

    const sourceConfig = source.config as Record<string, unknown> | null;
    const crawlProfile = sourceConfig?.crawlProfile as Record<string, unknown> | undefined;
    const maxPages = (crawlProfile?.maxPages as number) ?? 3;

    await discoveryQueue.upsertJobScheduler(
      `discovery-${source.code}`,
      { pattern: cronPattern },
      {
        name: `discovery:${source.code}`,
        data: {
          sourceCode: source.code,
          sourceId: source.id,
          scrapeRunId: 0, // Will be created by the worker before scraping
          page: 1,
          maxPages,
        },
        opts: DEFAULT_JOB_RETRY_OPTS,
      },
    );

    log.info(`Discovery schedule registered`, {
      source: source.code,
      cron: cronPattern,
      maxPages,
    });
  }

  log.info('Scheduler startup complete');
}
