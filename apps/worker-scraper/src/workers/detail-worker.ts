/**
 * BullMQ worker: scrapes individual listing detail pages.
 * Enqueues processing jobs with the extracted capture data.
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
  pageNavigationDelay,
  classifyScraperError,
  dismissCookieConsent,
} from '@rei/scraper-core';
import type { DetailJobData, ProcessingJobData } from '@rei/scraper-core';
import { sources } from '@rei/db';
import { createScrapeContext } from '../browser-pool.js';
import { getAdapter } from '../adapter-registry.js';

const log = createLogger('worker:detail');

export function createDetailWorker(): Worker<DetailJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const processingQueue = new Queue<ProcessingJobData>(QUEUE_NAMES.PROCESSING, {
    connection,
    prefix,
  });

  const rateLimiter = new PerDomainRateLimiter(12);
  const circuitBreaker = new SourceCircuitBreaker(5, 300_000);

  // Cache source configs to avoid per-job DB lookups
  const rateLimitCache = new Map<string, boolean>();

  async function ensureRateLimit(sourceCode: string): Promise<void> {
    if (rateLimitCache.has(sourceCode)) return;
    const row = await sources.findByCode(sourceCode);
    if (row?.rateLimitRpm) {
      rateLimiter.setDomainRpm(sourceCode, row.rateLimitRpm);
    }
    rateLimitCache.set(sourceCode, true);
  }

  const worker = new Worker<DetailJobData>(
    QUEUE_NAMES.SCRAPE_DETAIL,
    async (job: Job<DetailJobData>) => {
      const { sourceCode, sourceId, scrapeRunId, detailUrl, discoveryUrl } = job.data;
      const adapter = getAdapter(sourceCode);

      if (circuitBreaker.isOpen(sourceCode)) {
        log.warn('Circuit breaker open, skipping detail', { sourceCode, detailUrl });
        return;
      }

      await ensureRateLimit(sourceCode);

      const context = await createScrapeContext();
      try {
        const page = await context.newPage();

        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();

        // Use the adapter's buildDetailRequest for URL resolution
        const detailRequest = await adapter.buildDetailRequest({
          detailUrl,
          sourceCode,
          summaryPayload: {},
          discoveredAt: new Date().toISOString(),
        });
        const fullUrl = detailRequest?.url ?? detailUrl;

        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        await dismissCookieConsent(page, sourceCode);
        const html = await page.content();

        const detailCapture = await adapter.extractDetailPage({
          page,
          requestPlan: { url: fullUrl, metadata: { html } },
          sourceCode,
          scrapeRunId,
        });

        detailCapture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(detailCapture);
        detailCapture.discoveryUrl = discoveryUrl;

        await processingQueue.add(`process:${sourceCode}`, {
          sourceCode,
          sourceId,
          scrapeRunId,
          detailUrl: fullUrl,
          discoveryUrl,
          captureJson: JSON.stringify(detailCapture),
        });

        circuitBreaker.recordSuccess(sourceCode);
        const payload = detailCapture.payload as Record<string, unknown>;
        log.info('Detail extracted', { title: (payload.titleRaw as string) ?? 'Unknown' });
      } catch (err) {
        const errorClass = classifyScraperError(err);
        circuitBreaker.recordFailure(sourceCode, errorClass);
        log.error('Detail extraction failed', {
          detailUrl,
          errorClass,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
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
    log.error('Detail job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
