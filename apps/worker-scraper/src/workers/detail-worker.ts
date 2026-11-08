/**
 * BullMQ worker: fetches a listing's own page and hands the capture to processing. A page that is
 * gone (404 or 410) still goes to processing, so the listing gets retired. A blocked or blank page
 * fails the job instead, because neither holds listing data.
 */

import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DelayedError, WaitingError, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import type { BrowserContext, Page } from 'playwright';
import { loadConfig } from '@immoradar/config';
import type { DetailCapture, DetailContext, RequestPlan } from '@immoradar/contracts';
import { deadLetter } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import {
  ArtifactWriter,
  DEFAULT_JOB_RETRY_OPTS,
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  classifyScraperError,
  createQueue,
  getQueuePrefix,
  getRedisConnection,
  isEmptyDocument,
  navigateForCapture,
  pageNavigationDelay,
  setupRequestInterception,
} from '@immoradar/scraper-core';
import type { DetailJobData, ProcessingJobData } from '@immoradar/scraper-core';
import { untilAborted } from '../abort.js';
import { getAdapter } from '../adapter-registry.js';
import { acquirePageSlot, createScrapeContext } from '../browser-pool.js';
import { BlockedPageError, EmptyPageError } from '../page-errors.js';
import { checkSourceRunnable } from '../source-guard.js';
import type { ScraperWorkerDeps } from './worker-deps.js';

const log = createLogger('worker:detail');

/** Spreads jobs held back by an open breaker, so they don't all return at the same moment. */
const BREAKER_DELAY_JITTER_MS = 30_000;

/**
 * The key processing files the capture under. A captured page's own ID wins over the one
 * discovery recorded, so a listing whose search-page ID differs still reaches the right row.
 * Anything short of a full capture keeps the job's key, which is the sighting that queued it.
 */
export function chooseListingKey(
  extractionStatus: DetailCapture<unknown>['extractionStatus'],
  derivedKey: string,
  jobKey: string,
): string {
  if (extractionStatus !== 'captured') return jobKey;
  // Adapters build `${sourceCode}:${id}`, so a trailing colon means the page gave no ID.
  if (derivedKey === '' || derivedKey.endsWith(':')) return jobKey;
  return derivedKey;
}

/** The site's own ID, which a sighting key carries after the source code. */
function externalIdOf(sourceCode: string, sourceListingKey: string): string | null {
  const prefix = `${sourceCode}:`;
  return sourceListingKey.startsWith(prefix) ? sourceListingKey.slice(prefix.length) : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createDetailWorker(deps: ScraperWorkerDeps): Worker<DetailJobData> {
  const { shutdownSignal, rateLimiter, circuitBreaker } = deps;
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const config = loadConfig();
  const artifactWriter = new ArtifactWriter(config.artifacts.dir);
  const processingQueue = createQueue<ProcessingJobData>(QUEUE_NAMES.PROCESSING);

  async function writeFailureHtml(
    sourceCode: string,
    scrapeRunId: number,
    detailUrl: string,
    html: string,
  ): Promise<string | null> {
    if (!config.playwright.captureHtmlOnFailure) return null;
    try {
      return await artifactWriter.writeHtml(sourceCode, String(scrapeRunId), detailUrl, html);
    } catch (err) {
      log.warn('Could not save the failure HTML', { sourceCode, detailUrl, error: messageOf(err) });
      return null;
    }
  }

  /** Best effort: a failed capture never hides the error that caused it. */
  async function captureFailure(
    job: DetailJobData,
    context: BrowserContext | null,
    page: Page | null,
    harPath: string | undefined,
  ): Promise<Record<string, string | null>> {
    const { sourceCode, scrapeRunId, detailUrl } = job;
    const runId = String(scrapeRunId);
    const keys: Record<string, string | null> = { html: null, screenshot: null, har: null };
    if (page && !page.isClosed()) {
      if (config.playwright.captureScreenshotOnFailure) {
        try {
          keys['screenshot'] = await artifactWriter.captureScreenshot(
            sourceCode,
            runId,
            detailUrl,
            page,
          );
        } catch (err) {
          log.warn('Could not save the failure screenshot', { detailUrl, error: messageOf(err) });
        }
      }
      const html = await page.content().catch(() => null);
      if (html !== null)
        keys['html'] = await writeFailureHtml(sourceCode, scrapeRunId, detailUrl, html);
    }
    if (context && harPath) {
      try {
        // Playwright writes the HAR file when the context closes.
        await context.close();
        keys['har'] = await artifactWriter.writeHar(
          sourceCode,
          runId,
          detailUrl,
          await readFile(harPath),
        );
      } catch (err) {
        log.warn('Could not save the failure HAR', { detailUrl, error: messageOf(err) });
      }
    }
    return keys;
  }

  async function processDetail(job: Job<DetailJobData>, token?: string): Promise<void> {
    const { sourceCode, sourceId, scrapeRunId, detailUrl, discoveryUrl, sourceListingKey } =
      job.data;
    if (!sourceListingKey) {
      log.warn('Dropping a detail job queued before sightings existed', { sourceCode, detailUrl });
      return;
    }
    const gate = await checkSourceRunnable(sourceCode);
    if (!gate.runnable) {
      log.info('Dropping a detail job for a source that is off', {
        sourceCode,
        reason: gate.reason,
        detailUrl,
      });
      return;
    }
    if (circuitBreaker.isOpen(sourceCode)) {
      const until =
        (circuitBreaker.openUntil(sourceCode) ?? Date.now()) +
        Math.floor(Math.random() * BREAKER_DELAY_JITTER_MS);
      log.info('Breaker open, delaying the detail page', {
        sourceCode,
        detailUrl,
        until: new Date(until).toISOString(),
      });
      // A delayed job keeps its attempts.
      await job.moveToDelayed(until, token);
      throw new DelayedError();
    }
    if (gate.source.rateLimitRpm) rateLimiter.setDomainRpm(sourceCode, gate.source.rateLimitRpm);

    const harPath = config.playwright.captureHarOnFailure
      ? join(tmpdir(), `immoradar-har-${randomUUID()}.har`)
      : undefined;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let releaseSlot: (() => void) | null = null;
    // Closing the context makes a page that is still loading fail at once.
    const closeOnAbort = (): void => void context?.close().catch(() => {});
    shutdownSignal.addEventListener('abort', closeOnAbort, { once: true });

    try {
      await untilAborted(rateLimiter.waitForSlot(sourceCode), shutdownSignal);
      await untilAborted(pageNavigationDelay(), shutdownSignal);
      releaseSlot = await acquirePageSlot(shutdownSignal);
      context = await createScrapeContext(
        harPath ? { recordHarPath: harPath, sourceCode } : { sourceCode },
      );
      // A shutdown during Chromium's cold start found no context to close, so check again here.
      shutdownSignal.throwIfAborted();
      await setupRequestInterception(context);
      page = await context.newPage();
      shutdownSignal.throwIfAborted();

      const adapter = getAdapter(sourceCode);
      const plan: RequestPlan = (await adapter.buildDetailRequest({
        detailUrl,
        // Some adapters build the page URL from the ID when the link is relative.
        externalId: externalIdOf(sourceCode, sourceListingKey),
        sourceCode,
        summaryPayload: {},
        discoveredAt: new Date().toISOString(),
      })) ?? { url: detailUrl };
      const navigation = await navigateForCapture(page, plan, {
        sourceCode,
        navigationTimeoutMs: config.playwright.navigationTimeoutMs,
      });
      const html = await page.content();
      // The status is the site's own answer that the listing is gone, whatever the page says.
      const gone = navigation.status === 404 || navigation.status === 410;
      // Sent on to processing, a blank page would count as a fetch that found no listing.
      if (!gone && isEmptyDocument(html)) throw new EmptyPageError();
      const detailContext: DetailContext = {
        page,
        requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
        sourceCode,
        scrapeRunId,
      };
      const capture = await adapter.extractDetailPage(detailContext);
      const availability = gone ? 'not_found' : adapter.detectAvailability(detailContext).status;
      if (availability === 'blocked' || capture.extractionStatus === 'blocked') {
        throw new BlockedPageError();
      }

      const htmlStorageKey =
        capture.extractionStatus === 'parse_failed' && !gone
          ? await writeFailureHtml(sourceCode, scrapeRunId, detailUrl, html)
          : null;
      const derivedKey = adapter.deriveSourceListingKey(capture);
      const listingKey = chooseListingKey(capture.extractionStatus, derivedKey, sourceListingKey);
      if (capture.extractionStatus === 'captured' && listingKey !== sourceListingKey) {
        log.warn('Detail page ID differs from the sighting', {
          sourceCode,
          detailUrl,
          sightingKey: sourceListingKey,
          pageKey: listingKey,
        });
      }

      capture.sourceListingKeyCandidate = listingKey;
      capture.discoveryUrl = discoveryUrl;
      capture.responseStatus = navigation.status;
      capture.htmlStorageKey = htmlStorageKey;
      capture.harStorageKey = null;
      capture.availabilityStatus = availability;

      await processingQueue.add(
        `process:${sourceCode}`,
        {
          sourceCode,
          sourceId,
          scrapeRunId,
          detailUrl: plan.url,
          discoveryUrl,
          captureJson: JSON.stringify(capture),
          htmlStorageKey: htmlStorageKey ?? undefined,
          sightingKey: sourceListingKey,
        },
        DEFAULT_JOB_RETRY_OPTS,
      );
      circuitBreaker.recordSuccess(sourceCode);
      log.info('Detail page captured', {
        sourceCode,
        detailUrl,
        status: navigation.status,
        extractionStatus: capture.extractionStatus,
        availability,
      });
    } catch (err) {
      if (shutdownSignal.aborted) {
        // Back to the queue for the next start. A shutdown says nothing about the source.
        await job.moveToWait(token);
        throw new WaitingError();
      }
      const errorClass = classifyScraperError(err);
      circuitBreaker.recordFailure(sourceCode, errorClass);
      const artifacts = await captureFailure(job.data, context, page, harPath);
      log.error('Detail page failed', {
        sourceCode,
        detailUrl,
        errorClass,
        artifacts,
        error: messageOf(err),
      });
      throw err;
    } finally {
      releaseSlot?.();
      shutdownSignal.removeEventListener('abort', closeOnAbort);
      await context?.close().catch(() => {});
      if (harPath) await unlink(harPath).catch(() => {});
    }
  }

  const worker = new Worker<DetailJobData>(QUEUE_NAMES.SCRAPE_DETAIL, processDetail, {
    connection,
    prefix,
    concurrency: WORKER_CONCURRENCY,
  });

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
