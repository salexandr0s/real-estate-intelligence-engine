/**
 * BullMQ worker: end-to-end canary health check.
 *
 * Performs a dry-run probe of the full pipeline for one source at a time:
 * 1. Discovery: fetch 1 search page, extract listing URLs
 * 2. Detail: fetch 1 detail page, extract data
 * 3. Normalize: run source normalizer in memory (no DB write)
 * 4. Score: compute score in memory with a synthetic baseline (no DB write)
 *
 * No production data is written. Results are recorded in canary_results table.
 * 3 consecutive failures → source marked as degraded.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { createLogger } from '@rei/observability';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
  getAdapter,
  PerDomainRateLimiter,
  pageNavigationDelay,
  classifyScraperError,
  dismissCookieConsent,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  pickRandomViewport,
  pickRandomUserAgent,
  setupRequestInterception,
} from '@rei/scraper-core';
import type { CanaryJobData } from '@rei/scraper-core';
import type { CrawlProfile, BaselineLookup, SourceRawListingBase } from '@rei/contracts';
import { getAreaBucket, getRoomBucket } from '@rei/contracts';
import { sources, canaryResults, marketBaselines } from '@rei/db';
import {
  BaseSourceMapper,
  WillhabenMapper,
  Immoscout24Mapper,
  WohnnetMapper,
  DerStandardMapper,
  FindMyHomeMapper,
  OpenImmoMapper,
  RemaxMapper,
} from '@rei/normalization';
import { scoreListing } from '@rei/scoring';

const log = createLogger('worker:canary');

const CONSECUTIVE_FAILURE_THRESHOLD = 3;

const normalizerRegistry = new Map<string, BaseSourceMapper>([
  ['willhaben', new WillhabenMapper()],
  ['immoscout24', new Immoscout24Mapper()],
  ['wohnnet', new WohnnetMapper()],
  ['derstandard', new DerStandardMapper()],
  ['findmyhome', new FindMyHomeMapper()],
  ['openimmo', new OpenImmoMapper()],
  ['remax', new RemaxMapper()],
]);

export function createCanaryWorker(): Worker<CanaryJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const rateLimiter = new PerDomainRateLimiter(12);

  const worker = new Worker<CanaryJobData>(
    QUEUE_NAMES.CANARY,
    async (job: Job<CanaryJobData>) => {
      const startTime = Date.now();

      // Pick source: explicit or round-robin from active sources
      let sourceCode = job.data.sourceCode;
      if (!sourceCode) {
        const activeSources = await sources.findActive();
        if (activeSources.length === 0) {
          log.warn('No active sources for canary check');
          return;
        }
        const idx = Math.floor(Date.now() / 1000) % activeSources.length;
        sourceCode = activeSources[idx]!.code;
      }

      log.info('Canary check started', { sourceCode });

      const adapter = getAdapter(sourceCode);
      let browser: Browser | null = null;
      let context: BrowserContext | null = null;

      let discoveryOk = false;
      let detailOk = false;
      let ingestionOk = false;
      let scoringOk = false;
      let listingsFound = 0;
      let errorMessage: string | null = null;

      try {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({
          viewport: pickRandomViewport(),
          locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
          timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
          userAgent: pickRandomUserAgent(),
          javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
        });
        await setupRequestInterception(context);

        const page = await context.newPage();

        // ── Stage 1: Discovery ────────────────────────────────────────────

        const profile: CrawlProfile = {
          name: `${sourceCode}-canary`,
          sourceCode,
          maxPages: 1,
          sortOrder: 'published_desc',
        };

        const discoveryPlans = await adapter.buildDiscoveryRequests(profile);
        const plan = discoveryPlans[0];
        if (!plan) throw new Error('No discovery plan generated');

        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();
        await page.goto(plan.url, { waitUntil: 'networkidle', timeout: 30_000 });
        await dismissCookieConsent(page, sourceCode);

        const html = await page.content();
        const result = await adapter.extractDiscoveryPage({
          page,
          requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
          profile,
          scrapeRunId: 0,
        });

        listingsFound = result.items.length;
        discoveryOk = listingsFound > 0;

        if (!discoveryOk) {
          throw new Error(`Canary discovery found 0 listings for ${sourceCode}`);
        }

        log.info('Canary discovery OK', { sourceCode, listingsFound });

        // ── Stage 2: Detail (first listing only) ──────────────────────────

        const firstItem = result.items[0]!;
        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();

        const detailRequest = await adapter.buildDetailRequest({
          detailUrl: firstItem.detailUrl,
          sourceCode,
          summaryPayload: {},
          discoveredAt: new Date().toISOString(),
        });
        const detailUrl = detailRequest?.url ?? firstItem.detailUrl;

        await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        await dismissCookieConsent(page, sourceCode);
        const detailHtml = await page.content();

        const capture = await adapter.extractDetailPage({
          page,
          requestPlan: { url: detailUrl, metadata: { html: detailHtml } },
          sourceCode,
          scrapeRunId: 0,
        });
        capture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(capture);

        detailOk = true;
        log.info('Canary detail OK', { sourceCode });

        // ── Stage 3: Dry-run normalization (no DB write) ──────────────────

        const normalizer = normalizerRegistry.get(sourceCode);
        if (!normalizer) throw new Error(`No normalizer for source: ${sourceCode}`);

        const source = await sources.findByCode(sourceCode);
        if (!source) throw new Error(`Source not found: ${sourceCode}`);

        const normResult = normalizer.normalize(capture.payload as SourceRawListingBase, {
          sourceId: source.id,
          sourceListingKey: capture.sourceListingKeyCandidate ?? 'canary-probe',
          sourceExternalId: capture.externalId ?? null,
          rawListingId: 0,
          scrapeRunId: 0,
          canonicalUrl: capture.canonicalUrl ?? detailUrl,
          detailUrl,
        });

        ingestionOk = normResult.success && normResult.listing != null;

        if (ingestionOk) {
          log.info('Canary normalization OK', {
            sourceCode,
            title: normResult.listing!.title,
            completeness: normResult.listing!.completenessScore,
          });
        } else {
          log.warn('Canary normalization failed', {
            sourceCode,
            errors: normResult.errors,
          });
        }

        // ── Stage 4: Dry-run scoring (no DB write) ────────────────────────

        if (normResult.listing) {
          const listing = normResult.listing;
          const effectiveArea = listing.livingAreaSqm ?? listing.usableAreaSqm ?? null;
          const pricePerSqmEur =
            listing.listPriceEurCents != null && effectiveArea != null && effectiveArea > 0
              ? Math.round((listing.listPriceEurCents / 100 / effectiveArea) * 100) / 100
              : null;

          // Look up real baseline if available, else use a synthetic one
          let baseline: BaselineLookup;
          try {
            const baselineResult = await marketBaselines.findBaselineWithFallback({
              districtNo: listing.districtNo ?? null,
              operationType: listing.operationType,
              propertyType: listing.propertyType,
              areaBucket: getAreaBucket(effectiveArea),
              roomBucket: getRoomBucket(listing.rooms ?? null),
            });
            baseline = {
              districtBaselinePpsqmEur: baselineResult.baseline?.medianPpsqmEur ?? null,
              bucketBaselinePpsqmEur: baselineResult.baseline?.medianPpsqmEur ?? null,
              bucketSampleSize: baselineResult.baseline?.sampleSize ?? 0,
              fallbackLevel: baselineResult.fallbackLevel,
            };
          } catch {
            baseline = {
              districtBaselinePpsqmEur: null,
              bucketBaselinePpsqmEur: null,
              bucketSampleSize: 0,
              fallbackLevel: 'none',
            };
          }

          const score = scoreListing(
            {
              listingId: 0,
              listingVersionId: 0,
              pricePerSqmEur,
              districtNo: listing.districtNo ?? null,
              operationType: listing.operationType,
              propertyType: listing.propertyType,
              livingAreaSqm: listing.livingAreaSqm ?? null,
              rooms: listing.rooms ?? null,
              city: listing.city,
              title: listing.title,
              description: listing.description ?? null,
              firstSeenAt: new Date(),
              lastPriceChangeAt: null,
              completenessScore: listing.completenessScore,
              sourceHealthScore: 90,
              locationConfidence: 75,
              recentPriceDropPct: 0,
              relistDetected: false,
              proximityData: null,
            },
            baseline,
          );

          scoringOk = score.overallScore >= 0 && score.overallScore <= 100;

          log.info('Canary scoring OK', {
            sourceCode,
            overallScore: score.overallScore,
          });
        }
      } catch (err) {
        const errClass = classifyScraperError(err);
        errorMessage = err instanceof Error ? `${errClass}: ${err.message}` : String(err);
        log.error('Canary check failed', { sourceCode, errorClass: errClass, error: errorMessage });
      } finally {
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
      }

      const durationMs = Date.now() - startTime;
      const success = discoveryOk && detailOk && ingestionOk;

      // Record result (only canary_results table is written — no production data)
      await canaryResults.insert({
        sourceCode,
        success,
        discoveryOk,
        detailOk,
        ingestionOk,
        scoringOk,
        listingsFound,
        durationMs,
        errorMessage,
      });

      // Auto-degrade: 3 consecutive failures → mark source as degraded
      // Auto-recover: if source is degraded and latest canary succeeded → restore to healthy
      const recentResults = await canaryResults.findBySourceCode(
        sourceCode,
        CONSECUTIVE_FAILURE_THRESHOLD,
      );

      if (!success) {
        const allFailed =
          recentResults.length >= CONSECUTIVE_FAILURE_THRESHOLD &&
          recentResults.slice(0, CONSECUTIVE_FAILURE_THRESHOLD).every((r) => !r.success);

        if (allFailed) {
          const source = await sources.findByCode(sourceCode);
          if (source && source.healthStatus !== 'degraded' && source.healthStatus !== 'blocked') {
            await sources.updateHealthStatus(source.id, 'degraded');
            log.warn('Source degraded by canary', {
              sourceCode,
              consecutiveFailures: CONSECUTIVE_FAILURE_THRESHOLD,
            });
          }
        }
      } else {
        // Latest canary succeeded — check if source was degraded and should recover
        const source = await sources.findByCode(sourceCode);
        if (source && (source.healthStatus === 'degraded' || source.healthStatus === 'unknown')) {
          await sources.updateHealthStatus(source.id, 'healthy');
          log.info('Source recovered by canary', { sourceCode });
        }
      }

      log.info('Canary check complete', {
        sourceCode,
        success,
        discoveryOk,
        detailOk,
        ingestionOk,
        scoringOk,
        durationMs,
      });
    },
    {
      connection,
      prefix,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Canary job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
