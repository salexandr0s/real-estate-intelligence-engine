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
} from '@rei/scraper-core';
import type { DiscoveryJobData, DetailJobData } from '@rei/scraper-core';
import type { CrawlProfile } from '@rei/contracts';
import { scrapeRuns, sources } from '@rei/db';
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
      const { sourceCode, sourceId, scrapeRunId, maxPages } = job.data;
      const adapter = getAdapter(sourceCode);

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
              await detailQueue.add(`detail:${sourceCode}`, {
                sourceCode,
                sourceId,
                scrapeRunId,
                detailUrl: item.detailUrl,
                discoveryUrl: plan.url,
                title: String(
                  (item.summaryPayload as Record<string, unknown>)?.titleRaw ?? 'Unknown',
                ),
                externalId: item.externalId ?? undefined,
              });
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

        // Update source health so scheduler respects crawl interval
        if (finalStatus === 'succeeded') {
          await sources.updateHealthStatus(sourceId, 'healthy', new Date());
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
    log.error('Discovery job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
