/**
 * BullMQ worker: scrapes individual listing detail pages.
 * Enqueues processing jobs with the extracted capture data.
 */

import { Worker, Queue } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
  PerDomainRateLimiter,
  SourceCircuitBreaker,
  pageNavigationDelay,
  cooldownDelay,
  classifyScraperError,
  dismissCookieConsent,
  ArtifactWriter,
  setupRequestInterception,
  DEFAULT_JOB_RETRY_OPTS,
} from '@immoradar/scraper-core';
import type {
  DetailJobData,
  ProcessingJobData,
  DocumentProcessingJobData,
} from '@immoradar/scraper-core';
import type { DetailCapture } from '@immoradar/contracts';
import { loadConfig } from '@immoradar/config';
import { sources, deadLetter, documents, listings } from '@immoradar/db';
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

  const documentQueue = new Queue<DocumentProcessingJobData>(QUEUE_NAMES.DOCUMENT_PROCESSING, {
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

      // When HAR capture is enabled, record to a temp file so we can save
      // the HAR on failure. On success, the temp file is cleaned up.
      const harEnabled = config.playwright.captureHarOnFailure;
      const harTempPath = harEnabled
        ? join(tmpdir(), `immoradar-har-${randomUUID()}.har`)
        : undefined;

      const context = await createScrapeContext(
        harTempPath ? { recordHarPath: harTempPath, sourceCode } : { sourceCode },
      );
      await setupRequestInterception(context);

      let htmlStorageKey: string | undefined;
      let screenshotStorageKey: string | undefined;
      let harStorageKey: string | undefined;

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
        const availability = adapter.detectAvailability({
          page,
          requestPlan: { url: fullUrl, metadata: { html } },
          sourceCode,
          scrapeRunId,
        });

        detailCapture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(detailCapture);
        detailCapture.discoveryUrl = discoveryUrl;
        detailCapture.htmlStorageKey = htmlStorageKey ?? null;
        detailCapture.harStorageKey = harStorageKey ?? null;
        detailCapture.availabilityStatus = availability.status;

        await processingQueue.add(
          `process:${sourceCode}`,
          {
            sourceCode,
            sourceId,
            scrapeRunId,
            detailUrl: fullUrl,
            discoveryUrl,
            captureJson: JSON.stringify(detailCapture),
            htmlStorageKey,
            harStorageKey,
          },
          DEFAULT_JOB_RETRY_OPTS,
        );

        // Enqueue document processing for any attachment URLs found on the page.
        // Best-effort: failures here never break the main detail flow.
        try {
          await enqueueAttachmentDocuments(detailCapture, sourceId, documentQueue);
        } catch (docErr) {
          log.warn('Failed to enqueue attachment documents', {
            detailUrl: fullUrl,
            error: docErr instanceof Error ? docErr.message : String(docErr),
          });
        }

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

        // Capture HAR on failure — close context first to flush the HAR file
        if (harEnabled && harTempPath) {
          try {
            await context.close();
            const harBuffer = await readFile(harTempPath);
            harStorageKey = await artifactWriter.writeHar(
              sourceCode,
              String(scrapeRunId),
              detailUrl,
              harBuffer,
            );
          } catch (_harErr) {
            log.warn('Failed to capture HAR artifact');
          }
        }

        if (errorClass === 'soft_anti_bot') {
          log.warn('Soft block detected on detail page, applying cooldown', { sourceCode });
          await cooldownDelay();
        }

        log.error('Detail extraction failed', {
          detailUrl,
          errorClass,
          htmlStorageKey,
          screenshotStorageKey,
          harStorageKey,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        await context.close().catch(() => {});
        // Clean up HAR temp file regardless of outcome
        if (harTempPath) {
          await unlink(harTempPath).catch(() => {});
        }
      }
    },
    {
      connection,
      prefix,
      concurrency: config.scraper.detailWorkerConcurrency,
    },
  );

  worker.on('failed', (job, err) => {
    const isTerminal = job != null && job.attemptsMade >= (job.opts?.attempts ?? 1);
    log.error('Detail job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      terminal: isTerminal,
      error: err.message,
    });

    if (isTerminal && job) {
      deadLetter
        .insert({
          queueName: QUEUE_NAMES.SCRAPE_DETAIL,
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

/**
 * For each attachment URL on the detail capture, upsert a listing_documents
 * row (if the listing already exists) and enqueue a DOCUMENT_PROCESSING job.
 *
 * This is best-effort: if the listing hasn't been created yet (first scrape),
 * the attachmentUrls are preserved in captureJson for downstream handling.
 */
async function enqueueAttachmentDocuments(
  capture: DetailCapture<unknown>,
  sourceId: number,
  docQueue: Queue<DocumentProcessingJobData>,
): Promise<void> {
  const urls = capture.attachmentUrls;
  if (!urls || urls.length === 0) return;

  const sourceKey = capture.sourceListingKeyCandidate;
  if (!sourceKey) return;

  const listing = await listings.findBySourceKey(sourceId, sourceKey);
  if (!listing) {
    // Listing not yet created — attachmentUrls will be processed after ingestion
    log.debug('Listing not yet created, skipping document enqueue', {
      sourceKey,
      attachmentCount: urls.length,
    });
    return;
  }

  for (const attachment of urls) {
    const doc = await documents.upsertDocument({
      listingId: listing.id,
      url: attachment.url,
      label: attachment.label ?? null,
      mimeType: attachment.type ?? null,
      documentType: attachment.type ?? 'unknown',
    });

    if (doc.status !== 'extracted') {
      await docQueue.add(`doc:${doc.id}`, { documentId: doc.id }, DEFAULT_JOB_RETRY_OPTS);
    }

    log.info('Enqueued document for processing', {
      documentId: doc.id,
      listingId: listing.id,
      url: attachment.url,
    });
  }
}
