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
} from '@rei/scraper-core';
import type { DiscoveryJobData, DetailJobData } from '@rei/scraper-core';
import type { CrawlProfile } from '@rei/contracts';
import { WillhabenAdapter } from '@rei/source-willhaben';
import { scrapeRuns } from '@rei/db';
import { createScrapeContext } from '../browser-pool.js';

const log = createLogger('worker:discovery');

const adapters = new Map([['willhaben', new WillhabenAdapter()]]);

export function createDiscoveryWorker(): Worker<DiscoveryJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const detailQueue = new Queue<DetailJobData>(QUEUE_NAMES.SCRAPE_DETAIL, {
    connection,
    prefix,
  });

  const rateLimiter = new PerDomainRateLimiter(12);
  const circuitBreaker = new SourceCircuitBreaker(5, 300_000);

  const worker = new Worker<DiscoveryJobData>(
    QUEUE_NAMES.SCRAPE_DISCOVERY,
    async (job: Job<DiscoveryJobData>) => {
      const { sourceCode, sourceId, scrapeRunId, maxPages } = job.data;
      const adapter = adapters.get(sourceCode);
      if (!adapter) throw new Error(`Unknown source: ${sourceCode}`);

      log.info('Discovery job started', { sourceCode, scrapeRunId, maxPages });
      const runCtx = new ScrapeRunContext(scrapeRunId, sourceCode);

      const profile: CrawlProfile = {
        name: `${sourceCode}-scheduled`,
        sourceCode,
        maxPages,
        sortOrder: 'published_desc',
      };

      const discoveryPlans = await adapter.buildDiscoveryRequests(profile);
      const context = await createScrapeContext();

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
                title: item.summaryPayload.titleRaw ?? 'Unknown',
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
