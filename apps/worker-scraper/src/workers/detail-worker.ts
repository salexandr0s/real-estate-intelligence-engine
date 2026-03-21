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
  ArtifactWriter,
  setupRequestInterception,
} from '@rei/scraper-core';
import type { DetailJobData, ProcessingJobData } from '@rei/scraper-core';
import { loadConfig } from '@rei/config';
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

  const config = loadConfig();
  const artifactWriter = new ArtifactWriter(config.s3.bucket);
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
      await setupRequestInterception(context);

      let htmlStorageKey: string | undefined;
      let screenshotStorageKey: string | undefined;

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

        // Persist HTML artifact
        if (config.playwright.captureHtmlOnFailure) {
          try {
            htmlStorageKey = await artifactWriter.writeHtml(
              sourceCode,
              String(scrapeRunId),
              detailUrl,
              html,
            );
          } catch (writeErr) {
            log.warn('Failed to write HTML artifact', {
              error: writeErr instanceof Error ? writeErr.message : String(writeErr),
            });
          }
        }

        const detailCapture = await adapter.extractDetailPage({
          page,
          requestPlan: { url: fullUrl, metadata: { html } },
          sourceCode,
          scrapeRunId,
        });

        detailCapture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(detailCapture);
        detailCapture.discoveryUrl = discoveryUrl;
        detailCapture.htmlStorageKey = htmlStorageKey ?? null;

        await processingQueue.add(`process:${sourceCode}`, {
          sourceCode,
          sourceId,
          scrapeRunId,
          detailUrl: fullUrl,
          discoveryUrl,
          captureJson: JSON.stringify(detailCapture),
          htmlStorageKey,
        });

        circuitBreaker.recordSuccess(sourceCode);
        const payload = detailCapture.payload as Record<string, unknown>;
        log.info('Detail extracted', { title: (payload.titleRaw as string) ?? 'Unknown' });
      } catch (err) {
        const errorClass = classifyScraperError(err);
        circuitBreaker.recordFailure(sourceCode, errorClass);

        // Capture failure artifacts (screenshot + HTML)
        if (config.playwright.captureScreenshotOnFailure) {
          try {
            const pages = context.pages();
            if (pages.length > 0) {
              const buffer = await pages[0]!.screenshot({ fullPage: true });
              screenshotStorageKey = await artifactWriter.writeScreenshot(
                sourceCode,
                String(scrapeRunId),
                detailUrl,
                buffer,
              );
              if (!htmlStorageKey) {
                const failHtml = await pages[0]!.content();
                htmlStorageKey = await artifactWriter.writeHtml(
                  sourceCode,
                  String(scrapeRunId),
                  detailUrl,
                  failHtml,
                );
              }
            }
          } catch (_captureErr) {
            log.warn('Failed to capture failure artifacts');
          }
        }

        log.error('Detail extraction failed', {
          detailUrl,
          errorClass,
          htmlStorageKey,
          screenshotStorageKey,
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
