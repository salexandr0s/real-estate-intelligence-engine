/**
 * BullMQ worker: discovers listing URLs from source search pages.
 * Enqueues detail jobs for each discovered item.
 */

import { Worker, Queue } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@rei/observability';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
  PerDomainRateLimiter,
  SourceCircuitBreaker,
  ScrapeRunContext,
  pageNavigationDelay,
  classifyScraperError,
  dismissCookieConsent,
  setupRequestInterception,
  DEFAULT_JOB_RETRY_OPTS,
} from '@rei/scraper-core';
import type { DiscoveryJobData, DetailJobData } from '@rei/scraper-core';
import type { CrawlProfile } from '@rei/contracts';
import { scrapeRuns, sources, deadLetter } from '@rei/db';
import { createScrapeContext } from '../browser-pool.js';
import { getAdapter } from '../adapter-registry.js';

const log = createLogger('worker:discovery');

export function createDiscoveryWorker(): Worker<DiscoveryJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const detailQueue = new Queue<DetailJobData>(QUEUE_NAMES.SCRAPE_DETAIL, {
    connection,
    prefix,
  });

  const rateLimiter = new PerDomainRateLimiter(12);
  const circuitBreaker = new SourceCircuitBreaker(5, 300_000);

  // Cache source configs to avoid per-job DB lookups
  const sourceConfigCache = new Map<string, { rateLimitRpm: number | null; config: unknown }>();

  async function getSourceConfig(
    sourceCode: string,
  ): Promise<{ rateLimitRpm: number | null; config: unknown }> {
    const cached = sourceConfigCache.get(sourceCode);
    if (cached) return cached;
    const row = await sources.findByCode(sourceCode);
    const entry = { rateLimitRpm: row?.rateLimitRpm ?? null, config: row?.config ?? null };
    sourceConfigCache.set(sourceCode, entry);
    return entry;
  }

  const worker = new Worker<DiscoveryJobData>(
    QUEUE_NAMES.SCRAPE_DISCOVERY,
    async (job: Job<DiscoveryJobData>) => {
      const { sourceCode, sourceId, maxPages } = job.data;
      const adapter = getAdapter(sourceCode);

      // For repeatable/scheduled jobs, scrapeRunId is 0 — create a new run
      let scrapeRunId = job.data.scrapeRunId;
      if (!scrapeRunId) {
        const run = await scrapeRuns.create({
          sourceId,
          triggerType: 'schedule',
          scope: 'full',
          workerHost: 'discovery-worker',
          workerVersion: '1.0.0',
          browserType: 'chromium',
        });
        await scrapeRuns.start(run.id);
        scrapeRunId = run.id;
      }

      log.info('Discovery job started', { sourceCode, scrapeRunId, maxPages });
      const runCtx = new ScrapeRunContext(scrapeRunId, sourceCode);

      // Wire per-source rate limit (cached)
      const sourceCfg = await getSourceConfig(sourceCode);
      if (sourceCfg.rateLimitRpm) {
        rateLimiter.setDomainRpm(sourceCode, sourceCfg.rateLimitRpm);
      }

      // Build crawl profile from source config + job defaults
      const sourceConfig = sourceCfg.config as Record<string, unknown> | null;
      const crawlConfig = (sourceConfig?.crawlProfile ?? null) as Record<string, unknown> | null;
      const profile: CrawlProfile = {
        name: `${sourceCode}-scheduled`,
        sourceCode,
        maxPages,
        operationType: crawlConfig?.operationType as string | undefined,
        propertyType: crawlConfig?.propertyType as string | undefined,
        regions: crawlConfig?.regions as string[] | undefined,
        sortOrder: (crawlConfig?.sortOrder as string) ?? 'published_desc',
      };

      const discoveryPlans = await adapter.buildDiscoveryRequests(profile);
      const context = await createScrapeContext();
      await setupRequestInterception(context);

      try {
        const page = await context.newPage();
        let totalEnqueued = 0;

        for (const plan of discoveryPlans) {
          if (circuitBreaker.isOpen(sourceCode)) {
            log.warn('Circuit breaker open, stopping discovery', { sourceCode });
            break;
          }

          try {
            await rateLimiter.waitForSlot(sourceCode);
            await pageNavigationDelay();

            await page.goto(plan.url, { waitUntil: 'networkidle', timeout: 30_000 });
            await dismissCookieConsent(page, sourceCode);
            const html = await page.content();
            runCtx.incrementMetric('pagesFetched');
            runCtx.incrementMetric('http2xx');

            const result = await adapter.extractDiscoveryPage({
              page,
              requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
              profile,
              scrapeRunId,
            });

            for (const item of result.items) {
              await detailQueue.add(
                `detail:${sourceCode}`,
                {
                  sourceCode,
                  sourceId,
                  scrapeRunId,
                  detailUrl: item.detailUrl,
                  discoveryUrl: plan.url,
                  title: String(
                    (item.summaryPayload as Record<string, unknown>)?.titleRaw ?? 'Unknown',
                  ),
                  externalId: item.externalId ?? undefined,
                },
                DEFAULT_JOB_RETRY_OPTS,
              );
              totalEnqueued++;
            }

            runCtx.incrementMetric('listingsDiscovered', result.items.length);
            circuitBreaker.recordSuccess(sourceCode);
            log.info(`Discovered ${result.items.length} items`, {
              page: (plan.metadata as Record<string, unknown>)?.page,
            });
          } catch (err) {
            const errorClass = classifyScraperError(err);
            circuitBreaker.recordFailure(sourceCode, errorClass);
            log.error('Discovery page failed', { url: plan.url, errorClass });
            runCtx.incrementMetric('http4xx');
          }
        }

        const metrics = runCtx.getMetrics();
        await scrapeRuns.updateMetrics(scrapeRunId, {
          pagesFetched: metrics.pagesFetched,
          listingsDiscovered: metrics.listingsDiscovered,
        });

        const finalStatus = totalEnqueued > 0 ? 'succeeded' : 'failed';
        await scrapeRuns.finish(scrapeRunId, finalStatus, metrics);

        // Update source health and detect transitions
        if (finalStatus === 'succeeded') {
          await sources.updateHealthStatus(sourceId, 'healthy', new Date());
        }

        // Check health transitions and log for monitoring
        const healthResult = await sources.checkAndUpdateHealth(sourceId);
        if (healthResult.changed) {
          const severity =
            healthResult.newStatus === 'blocked' || healthResult.newStatus === 'disabled'
              ? 'error'
              : healthResult.newStatus === 'degraded'
                ? 'warn'
                : 'info';

          // Structured log that external monitoring (e.g. Grafana/PagerDuty) can trigger on
          const logMethod =
            severity === 'error' ? log.error : severity === 'warn' ? log.warn : log.info;
          logMethod.call(log, 'SOURCE_HEALTH_TRANSITION', {
            sourceCode,
            sourceId,
            previousStatus: healthResult.previousStatus,
            newStatus: healthResult.newStatus,
            severity,
          });
        }

        // Anomaly detection: compare this run against rolling average
        if (finalStatus === 'succeeded') {
          const stats = await scrapeRuns.findRecentAverage(sourceId, 168); // 7 days
          if (stats.runCount >= 3 && stats.avgDiscovered > 0) {
            const ratio = totalEnqueued / stats.avgDiscovered;
            if (ratio < 0.2) {
              log.warn('SCRAPE_ANOMALY_DETECTED', {
                sourceCode,
                sourceId,
                discovered: totalEnqueued,
                avgDiscovered: Math.round(stats.avgDiscovered),
                ratio: Math.round(ratio * 100) / 100,
                recentRuns: stats.runCount,
              });
            }
          }
        }

        log.info('Discovery job complete', { sourceCode, totalEnqueued, finalStatus });
      } finally {
        await context.close().catch(() => {});
      }
    },
    {
      connection,
      prefix,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    const isTerminal = job != null && job.attemptsMade >= (job.opts?.attempts ?? 1);
    log.error('Discovery job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      terminal: isTerminal,
      error: err.message,
    });

    if (isTerminal && job) {
      deadLetter
        .insert({
          queueName: QUEUE_NAMES.SCRAPE_DISCOVERY,
          jobId: job.id ?? 'unknown',
          jobData: job.data as unknown as Record<string, unknown>,
          errorMessage: err.message,
          errorClass: classifyScraperError(err),
          sourceCode: job.data.sourceCode,
          attempts: job.attemptsMade,
        })
        .catch((dlqErr) => log.error('DLQ insert failed', { error: String(dlqErr) }));
    }
  });

  return worker;
}
