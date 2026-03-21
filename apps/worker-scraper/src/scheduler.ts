/**
 * Scheduler: enqueues repeatable scrape discovery jobs and baseline recomputation.
 */

import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createLogger } from '@rei/observability';
import { loadConfig } from '@rei/config';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
} from '@rei/scraper-core';
import type { DiscoveryJobData, BaselineJobData } from '@rei/scraper-core';
import { sources, scrapeRuns } from '@rei/db';

const log = createLogger('scheduler');

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

  // Schedule baseline recomputation every hour
  await baselineQueue.upsertJobScheduler(
    'baseline-hourly',
    { pattern: '0 * * * *' },
    {
      name: 'baseline:recompute',
      data: { triggeredBy: 'scheduler' },
    },
  );
  log.info('Baseline scheduler registered (hourly)');

  // Periodic scrape scheduling loop
  const intervalMs = config.scheduler.loopIntervalMs;
  log.info(`Scheduler loop starting (interval: ${intervalMs}ms)`);

  const scheduleLoop = async (): Promise<void> => {
    try {
      const activeSources = await sources.findActive();

      for (const source of activeSources) {
        const crawlIntervalMs = (source.crawlIntervalMinutes ?? 30) * 60_000;
        const lastRun = source.lastSuccessfulRunAt;
        const now = Date.now();

        if (lastRun && now - new Date(lastRun).getTime() < crawlIntervalMs) {
          continue; // not due yet
        }

        log.info('Enqueueing discovery scrape', { sourceCode: source.code });

        // Create scrape run
        const run = await scrapeRuns.create({
          sourceId: source.id,
          triggerType: 'schedule',
          scope: 'full',
          workerHost: 'scheduler',
          workerVersion: '1.0.0',
          browserType: 'chromium',
        });
        await scrapeRuns.start(run.id);

        // Read crawl profile config from source
        const sourceConfig = source.config as Record<string, unknown> | null;
        const crawlProfile = sourceConfig?.crawlProfile as Record<string, unknown> | undefined;
        const maxPages = (crawlProfile?.maxPages as number) ?? 3;

        await discoveryQueue.add(`discovery:${source.code}`, {
          sourceCode: source.code,
          sourceId: source.id,
          scrapeRunId: run.id,
          page: 1,
          maxPages,
        });
      }
    } catch (err) {
      log.error('Scheduler loop error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Run immediately, then on interval
  await scheduleLoop();
  setInterval(() => void scheduleLoop(), intervalMs);
}
