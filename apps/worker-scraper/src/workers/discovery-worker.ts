/**
 * BullMQ worker: crawls a source's search pages and records every listing it sights. After the
 * sweep it queues the detail pages most worth fetching, at most SCRAPER_DETAIL_BUDGET_PER_RUN per
 * run. Every run ends with a status that says how far it got and why it stopped.
 */

import { createHash } from 'node:crypto';
import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import type { BrowserContext, Page } from 'playwright';
import { loadConfig } from '@immoradar/config';
import type {
  CrawlProfile,
  DiscoveryItem,
  DiscoveryPageResult,
  ErrorClass,
  RequestPlan,
  ScrapeRunCause,
  ScrapeRunMetrics,
} from '@immoradar/contracts';
import { deadLetter, rawSightings, scrapeRuns } from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import {
  DEFAULT_JOB_RETRY_OPTS,
  HttpStatusError,
  QUEUE_NAMES,
  ScrapeRunContext,
  WORKER_CONCURRENCY,
  classifyScraperError,
  createQueue,
  discoverySchedulerId,
  getQueuePrefix,
  getRedisConnection,
  maxPagesForSource,
  navigateForCapture,
  pageNavigationDelay,
  setupRequestInterception,
} from '@immoradar/scraper-core';
import type { DetailJobData, DiscoveryJobData } from '@immoradar/scraper-core';
import { untilAborted } from '../abort.js';
import { getAdapter } from '../adapter-registry.js';
import { acquirePageSlot, createScrapeContext } from '../browser-pool.js';
import { applyRunToSource, checkSourceRunnable } from '../source-guard.js';
import type { ScraperWorkerDeps } from './worker-deps.js';

const log = createLogger('worker:discovery');

/** Detail slots kept for active listings discovery no longer sights, so they still get rechecked. */
const REVALIDATION_SLOTS = 10;

/** Why the page loop stopped. */
export type DiscoveryEnd =
  | { kind: 'exhausted' }
  | { kind: 'page_cap' }
  /** `reason` is the class of the failures that opened the breaker. */
  | { kind: 'breaker_open'; reason: ErrorClass | null }
  | { kind: 'page_error'; errorClass: ErrorClass; message: string }
  | { kind: 'shutdown' }
  | { kind: 'cancelled' };

export interface RunOutcome {
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'rate_limited';
  cause?: ScrapeRunCause;
}

function outcome(
  status: RunOutcome['status'],
  errorCode?: string,
  errorMessage?: string,
): RunOutcome {
  return errorCode
    ? { status, cause: { errorCode, errorMessage: errorMessage ?? null } }
    : { status };
}

/**
 * Only a run whose pagination ran out by itself succeeds. One that stopped early with listings in
 * hand is partial. One that found no listings failed, unless the breaker held it back before its
 * first page.
 */
export function resolveRunOutcome(end: DiscoveryEnd, pages: number, items: number): RunOutcome {
  switch (end.kind) {
    case 'shutdown':
      return outcome('cancelled', 'shutdown', 'The scraper stopped during the run');
    case 'cancelled':
      return outcome('cancelled', 'user_cancelled', 'Cancelled by user');
    case 'breaker_open':
      // The cause is the class that opened the breaker, so a pause that network errors caused
      // doesn't count toward switching the source off.
      if (pages === 0) {
        return outcome(
          'rate_limited',
          end.reason ?? 'circuit_open',
          'Recent failures paused this source',
        );
      }
      break;
    case 'page_error':
      if (items === 0) return outcome('failed', end.errorClass, end.message);
      break;
    default:
      break;
  }
  if (pages === 0)
    return outcome('failed', 'no_pages', 'The source gave no search page to start from');
  if (items === 0) return outcome('failed', 'no_items', `${pages} search pages gave no listings`);

  switch (end.kind) {
    case 'exhausted':
      return outcome('succeeded');
    case 'page_cap':
      return outcome('partial', 'page_cap', `Stopped at the limit of ${pages} pages`);
    case 'breaker_open':
      return outcome('partial', 'circuit_open', 'Recent failures paused this source mid-run');
    case 'page_error':
      return outcome('partial', end.errorClass, end.message);
    default:
      return outcome('failed', 'internal_error', 'The run ended in an unexpected state');
  }
}

/** Fields that show a listing changed. Image URLs rotate on some sites, so they're left out. */
function summaryHash(summary: unknown): string {
  const fields = (typeof summary === 'object' && summary !== null ? summary : {}) as Record<
    string,
    unknown
  >;
  const relevant = ['titleRaw', 'priceRaw', 'areaRaw', 'roomsRaw', 'locationRaw'].map(
    (name) => fields[name] ?? null,
  );
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/** Items without an ID can't be matched to a listing, so they aren't sighted. */
function toSightings(
  sourceCode: string,
  discoveryUrl: string,
  items: DiscoveryItem<unknown>[],
): rawSightings.PageSighting[] {
  return items.flatMap((item) => {
    const id = item.externalId?.trim();
    if (!id) return [];
    return [
      {
        sourceListingKey: `${sourceCode}:${id}`,
        detailUrl: item.detailUrl,
        discoveryUrl,
        summarySha256: summaryHash(item.summaryPayload),
      },
    ];
  });
}

function countStatus(runCtx: ScrapeRunContext, status: number | null): void {
  if (status === null) return;
  if (status >= 200 && status < 300) runCtx.incrementMetric('http2xx');
  else if (status >= 400 && status < 500) runCtx.incrementMetric('http4xx');
  else if (status >= 500) runCtx.incrementMetric('http5xx');
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const EMPTY_METRICS: ScrapeRunMetrics = new ScrapeRunContext(0, '').getMetrics();

export function createDiscoveryWorker(deps: ScraperWorkerDeps): Worker<DiscoveryJobData> {
  const { shutdownSignal, rateLimiter, circuitBreaker } = deps;
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const config = loadConfig();

  const detailQueue = createQueue<DetailJobData>(QUEUE_NAMES.SCRAPE_DETAIL);
  const discoveryQueue = createQueue<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY);

  async function isCancelled(scrapeRunId: number): Promise<boolean> {
    return (await scrapeRuns.findById(scrapeRunId))?.status === 'cancelled';
  }

  async function fetchPage(
    page: Page,
    plan: RequestPlan,
    profile: CrawlProfile,
    scrapeRunId: number,
    runCtx: ScrapeRunContext,
  ): Promise<DiscoveryPageResult<unknown>> {
    const { sourceCode } = profile;
    await untilAborted(rateLimiter.waitForSlot(sourceCode), shutdownSignal);
    await untilAborted(pageNavigationDelay(), shutdownSignal);
    const releaseSlot = await acquirePageSlot(shutdownSignal);
    try {
      const navigation = await navigateForCapture(page, plan, {
        sourceCode,
        navigationTimeoutMs: config.playwright.navigationTimeoutMs,
      });
      countStatus(runCtx, navigation.status);
      if (navigation.selectorFound === false) {
        log.warn('Search page loaded without its selector', { sourceCode, url: plan.url });
      }
      const html = await page.content();
      return await getAdapter(sourceCode).extractDiscoveryPage({
        page,
        requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
        profile,
        scrapeRunId,
      });
    } finally {
      releaseSlot();
    }
  }

  /**
   * Queues this run's new and changed listings first, then active listings discovery stopped
   * sighting, which only their own pages can confirm or retire.
   */
  async function queueDetailPages(
    sourceId: number,
    sourceCode: string,
    scrapeRunId: number,
  ): Promise<number> {
    const budget = config.scraper.detailBudgetPerRun;
    const staleDays = config.scheduler.staleThresholdDays;
    const fresh = await rawSightings.selectFresh({
      sourceId,
      scrapeRunId,
      refreshDays: config.scraper.detailRefreshDays,
      recheckInactiveDays: staleDays,
      limit: Math.max(0, budget - REVALIDATION_SLOTS),
    });
    const revalidate = await rawSightings.selectRevalidate(
      sourceId,
      staleDays,
      Math.max(0, budget - fresh.length),
    );
    const candidates = [...fresh, ...revalidate];

    for (const candidate of candidates) {
      await detailQueue.add(
        `detail:${sourceCode}`,
        {
          sourceCode,
          sourceId,
          scrapeRunId,
          detailUrl: candidate.detailUrl,
          discoveryUrl: candidate.discoveryUrl,
          sourceListingKey: candidate.sourceListingKey,
        },
        {
          ...DEFAULT_JOB_RETRY_OPTS,
          attempts: 2,
          // Held while the job waits or runs, so an overlapping run can't queue the same page.
          deduplication: { id: `detail-${candidate.sourceListingKey.replace(/:/g, '-')}` },
        },
      );
    }
    await rawSightings.markEnqueued(
      sourceId,
      candidates.map((candidate) => candidate.sourceListingKey),
    );
    return candidates.length;
  }

  async function warnOnAnomaly(sourceId: number, sourceCode: string, items: number): Promise<void> {
    const stats = await scrapeRuns.findRecentAverage(sourceId, 168);
    if (stats.runCount < 3 || stats.avgDiscovered <= 0) return;
    const ratio = items / stats.avgDiscovered;
    if (ratio < 0.2) {
      log.warn('SCRAPE_ANOMALY_DETECTED', {
        sourceCode,
        sourceId,
        discovered: items,
        avgDiscovered: Math.round(stats.avgDiscovered),
        ratio: Math.round(ratio * 100) / 100,
        recentRuns: stats.runCount,
      });
    }
  }

  async function finishAfterError(
    scrapeRunId: number,
    sourceCode: string,
    err: unknown,
    metrics: ScrapeRunMetrics,
  ): Promise<void> {
    const aborted = shutdownSignal.aborted;
    log.error('Discovery run stopped by an error', {
      sourceCode,
      scrapeRunId,
      aborted,
      error: messageOf(err),
    });
    if (!scrapeRunId) return;
    try {
      // Failures on our side, such as Chromium not starting, don't count against the source.
      await scrapeRuns.finish(
        scrapeRunId,
        aborted ? 'cancelled' : 'failed',
        metrics,
        aborted
          ? { errorCode: 'shutdown', errorMessage: 'The scraper stopped during the run' }
          : { errorCode: 'internal_error', errorMessage: messageOf(err) },
      );
    } catch (finishErr) {
      log.error('Could not finish the discovery run', {
        sourceCode,
        scrapeRunId,
        error: messageOf(finishErr),
      });
    }
  }

  async function runDiscovery(job: Job<DiscoveryJobData>): Promise<void> {
    const { sourceCode, sourceId } = job.data;
    let scrapeRunId = job.data.scrapeRunId || 0;
    let runCtx: ScrapeRunContext | null = null;
    let context: BrowserContext | null = null;
    // Closing the context makes a page that is still loading fail at once.
    const closeOnAbort = (): void => void context?.close().catch(() => {});
    shutdownSignal.addEventListener('abort', closeOnAbort, { once: true });

    try {
      const gate = await checkSourceRunnable(sourceCode);
      if (!gate.runnable) {
        log.info('Skipping discovery for a source that is off', {
          sourceCode,
          reason: gate.reason,
        });
        if (scrapeRunId) {
          await scrapeRuns.finish(scrapeRunId, 'cancelled', EMPTY_METRICS, {
            errorCode: `source_${gate.reason}`,
            errorMessage: 'The source is switched off',
          });
        }
        await discoveryQueue.removeJobScheduler(discoverySchedulerId(sourceCode));
        return;
      }
      const source = gate.source;

      if (!scrapeRunId) {
        const run = await scrapeRuns.create({
          sourceId,
          triggerType: 'schedule',
          scope: 'full',
          workerHost: 'discovery-worker',
          workerVersion: '1.0.0',
          browserType: 'chromium',
        });
        scrapeRunId = run.id;
      }
      // Starts only a queued run, so a manual run cancelled before it began stays cancelled.
      if (!(await scrapeRuns.start(scrapeRunId))) {
        log.info('Skipping a run that is no longer queued', { sourceCode, scrapeRunId });
        return;
      }

      if (source.rateLimitRpm) rateLimiter.setDomainRpm(sourceCode, source.rateLimitRpm);
      const pageCap = maxPagesForSource(source.config, config.scraper.maxPagesPerRun);
      // Job data can outlive a config change in Redis, so the cap applies here as well.
      const maxPages = Math.max(
        1,
        Math.min(job.data.maxPagesPerRun ?? job.data.maxPages ?? pageCap, pageCap),
      );

      const crawlConfig = (source.config['crawlProfile'] ?? null) as Record<string, unknown> | null;
      const profile: CrawlProfile = {
        name: `${sourceCode}-scheduled`,
        sourceCode,
        maxPages: 1, // Only page 1 is built; pagination follows each page's nextPagePlan.
        maxPagesPerRun: maxPages,
        operationType: crawlConfig?.['operationType'] as string | undefined,
        propertyType: crawlConfig?.['propertyType'] as string | undefined,
        regions: crawlConfig?.['regions'] as string[] | undefined,
        sortOrder: (crawlConfig?.['sortOrder'] as string | undefined) ?? 'published_desc',
      };

      log.info('Discovery run started', { sourceCode, scrapeRunId, maxPages });
      runCtx = new ScrapeRunContext(scrapeRunId, sourceCode);
      let plan: RequestPlan | null =
        (await getAdapter(sourceCode).buildDiscoveryRequests(profile))[0] ?? null;
      let end: DiscoveryEnd = { kind: 'exhausted' };
      let pages = 0;
      let items = 0;

      // Chromium takes seconds to start, so a shutdown or an open breaker ends the run first.
      // openUntil leaves the half-open probe for the page loop to claim.
      if (shutdownSignal.aborted) {
        end = { kind: 'shutdown' };
      } else if (circuitBreaker.openUntil(sourceCode) !== null) {
        end = { kind: 'breaker_open', reason: circuitBreaker.openReason(sourceCode) };
      } else if (plan) {
        context = await createScrapeContext({ sourceCode });
        await setupRequestInterception(context);
        const page = await context.newPage();

        while (plan) {
          if (shutdownSignal.aborted) {
            end = { kind: 'shutdown' };
            break;
          }
          if (pages >= maxPages) {
            end = { kind: 'page_cap' };
            break;
          }
          if (circuitBreaker.isOpen(sourceCode)) {
            end = { kind: 'breaker_open', reason: circuitBreaker.openReason(sourceCode) };
            break;
          }
          if (pages > 0 && (await isCancelled(scrapeRunId))) {
            end = { kind: 'cancelled' };
            break;
          }

          const currentPlan: RequestPlan = plan;
          let result: DiscoveryPageResult<unknown>;
          try {
            result = await fetchPage(page, currentPlan, profile, scrapeRunId, runCtx);
          } catch (err) {
            if (shutdownSignal.aborted) {
              end = { kind: 'shutdown' };
              break;
            }
            const errorClass = classifyScraperError(err);
            circuitBreaker.recordFailure(sourceCode, errorClass);
            if (err instanceof HttpStatusError) countStatus(runCtx, err.statusCode);
            log.error('Search page failed', {
              sourceCode,
              url: currentPlan.url,
              errorClass,
              error: messageOf(err),
            });
            end = { kind: 'page_error', errorClass, message: messageOf(err) };
            break;
          }

          pages++;
          runCtx.incrementMetric('pagesFetched');
          circuitBreaker.recordSuccess(sourceCode);
          const sightings = toSightings(sourceCode, currentPlan.url, result.items);
          await rawSightings.upsertPage(sourceId, scrapeRunId, sightings);
          items += result.items.length;
          runCtx.incrementMetric('listingsDiscovered', result.items.length);
          if (sightings.length < result.items.length) {
            log.warn('Listings without an ID were not recorded', {
              sourceCode,
              page: pages,
              skipped: result.items.length - sightings.length,
            });
          }
          log.info(`Discovered ${result.items.length} items`, {
            sourceCode,
            page: pages,
            totalEstimate: result.totalEstimate,
            hasNextPage: result.nextPagePlan !== null,
          });

          // An empty page ends the sweep, whatever the parser says about a next one.
          plan = result.items.length === 0 ? null : result.nextPagePlan;
        }
      }

      // A cancel that arrives after the last page check still stops detail fetches.
      if (end.kind !== 'shutdown' && end.kind !== 'cancelled' && (await isCancelled(scrapeRunId))) {
        end = { kind: 'cancelled' };
      }

      // Search pages that load but list nothing usually mean the markup changed, and the detail
      // parser may be broken too, so revalidating then would only collect false strikes.
      let queued = 0;
      if (items > 0 && end.kind !== 'shutdown' && end.kind !== 'cancelled') {
        queued = await queueDetailPages(sourceId, sourceCode, scrapeRunId);
      }

      const result = resolveRunOutcome(end, pages, items);
      // Null when the run had already ended, for example cancelled by the user in the meantime.
      const finished = await scrapeRuns.finish(
        scrapeRunId,
        result.status,
        runCtx.getMetrics(),
        result.cause,
      );
      if (finished && result.status !== 'cancelled') {
        await applyRunToSource(
          {
            sourceId,
            sourceCode,
            status: result.status,
            errorCode: result.cause?.errorCode ?? null,
          },
          discoveryQueue,
        );
      }
      if (result.status === 'succeeded') await warnOnAnomaly(sourceId, sourceCode, items);

      log.info('Discovery run finished', {
        sourceCode,
        scrapeRunId,
        status: result.status,
        errorCode: result.cause?.errorCode ?? null,
        pages,
        items,
        queued,
      });
    } catch (err) {
      await finishAfterError(scrapeRunId, sourceCode, err, runCtx?.getMetrics() ?? EMPTY_METRICS);
    } finally {
      shutdownSignal.removeEventListener('abort', closeOnAbort);
      await context?.close().catch(() => {});
    }
  }

  const worker = new Worker<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY, runDiscovery, {
    connection,
    prefix,
    concurrency: WORKER_CONCURRENCY,
  });

  // A run catches its own errors, so this sees only failures BullMQ raises itself, such as a
  // stalled job.
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
