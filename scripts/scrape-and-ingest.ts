#!/usr/bin/env npx tsx
/**
 * CLI scrape-and-ingest script.
 *
 * Launches Playwright, scrapes willhaben discovery + detail pages,
 * and feeds captures through the FullIngestionPipeline.
 *
 * Usage:
 *   npx tsx scripts/scrape-and-ingest.ts [--max-pages N] [--dry-run]
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';
import {
  PerDomainRateLimiter,
  SourceCircuitBreaker,
  ScrapeRunContext,
  computeContentHash,
  pageNavigationDelay,
  classifyScraperError,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
} from '@rei/scraper-core';
import { WillhabenAdapter } from '@rei/source-willhaben';
import { WillhabenMapper } from '@rei/normalization';
import { FullIngestionPipeline } from '@rei/ingestion';
import type { FullIngestionPipelineDeps } from '@rei/ingestion';
import type { BaselineLookup, CrawlProfile, ListingStatus } from '@rei/contracts';
import { scoreListing } from '@rei/scoring';
import {
  sources,
  scrapeRuns,
  rawListings,
  listings,
  listingVersions,
  listingScores,
  marketBaselines,
  userFilters,
  alerts,
  closePool,
} from '@rei/db';

const log = createLogger('scrape-cli');

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { maxPages: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let maxPages = 3;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-pages' && args[i + 1]) {
      maxPages = parseInt(args[i + 1]!, 10);
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { maxPages, dryRun };
}

// ── Pipeline deps wiring ────────────────────────────────────────────────────

function buildPipelineDeps(): FullIngestionPipelineDeps {
  return {
    raw: {
      upsertRawSnapshot: async (input) => {
        const row = await rawListings.upsertRawSnapshot(input);
        return { id: row.id, isNew: row.observationCount === 1 };
      },
      updateScrapeRunMetrics: async (runId, metrics) => {
        await scrapeRuns.updateMetrics(runId, metrics);
      },
      computeContentHash,
    },
    normalization: {
      findExistingListing: async (sourceId, sourceListingKey) => {
        const row = await listings.findBySourceKey(sourceId, sourceListingKey);
        if (!row) return null;
        return {
          id: row.id,
          contentFingerprint: row.contentFingerprint,
          listingStatus: row.listingStatus,
          listPriceEurCents: row.listPriceEurCents,
          firstSeenAt: row.firstSeenAt,
          lastPriceChangeAt: row.lastPriceChangeAt,
        };
      },
      upsertListing: async (input) => {
        const existing = await listings.findBySourceKey(input.sourceId, input.sourceListingKey);
        const row = await listings.upsertListing(input);
        return { id: row.id, isNew: !existing };
      },
      appendListingVersion: async (input) => {
        const row = await listingVersions.appendVersion({
          ...input,
          listingStatus: input.listingStatus as ListingStatus,
        });
        return { id: row.id, versionNo: row.versionNo };
      },
      updateScrapeRunNormalizationCounts: async (runId, created, updated) => {
        await scrapeRuns.updateMetrics(runId, {
          normalizedCreated: created,
          normalizedUpdated: updated,
        });
      },
    },
    scoreAndAlert: {
      findBaseline: async (districtNo, operationType, propertyType, areaBucket, roomBucket) => {
        const result = await marketBaselines.findBaselineWithFallback({
          districtNo,
          operationType,
          propertyType,
          areaBucket,
          roomBucket,
        });
        const bl: BaselineLookup = {
          districtBaselinePpsqmEur: result.baseline?.medianPpsqmEur ?? null,
          bucketBaselinePpsqmEur: result.baseline?.medianPpsqmEur ?? null,
          bucketSampleSize: result.baseline?.sampleSize ?? 0,
          fallbackLevel: result.fallbackLevel,
        };
        return bl;
      },
      scoreListing,
      persistScore: async (listingId, listingVersionId, score) => {
        await listingScores.insertScore(listingId, listingVersionId, score);
      },
      updateListingScore: async (listingId, score, scoredAt) => {
        await listings.updateScore(listingId, score, scoredAt);
      },
      findMatchingFilters: async (listing) => {
        const filters = await userFilters.findMatchingFilters(listing);
        return filters.map((f) => ({ filterId: f.id, userId: f.userId }));
      },
      createAlert: async (alert) => {
        const row = await alerts.create(alert);
        return row ? { id: row.id } : null;
      },
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { maxPages, dryRun } = parseArgs();
  const config = loadConfig();

  log.info('Starting scrape-and-ingest', { maxPages, dryRun });

  // 1. Look up willhaben source
  const source = await sources.findByCode('willhaben');
  if (!source) {
    log.error('Source "willhaben" not found in sources table. Run db:seed first.');
    process.exit(1);
  }

  if (dryRun) {
    log.info('DRY RUN mode — will parse but not persist');
  }

  // 2. Create scrape run
  const run = await scrapeRuns.create({
    sourceId: source.id,
    triggerType: 'manual',
    scope: 'full',
    workerHost: 'cli',
    workerVersion: '1.0.0',
    browserType: 'chromium',
  });
  await scrapeRuns.start(run.id);

  const runCtx = new ScrapeRunContext(run.id, 'willhaben');

  // 3. Setup adapter, pipeline, rate limiter, circuit breaker
  const adapter = new WillhabenAdapter();
  const normalizers = new Map([['willhaben', new WillhabenMapper()]]);
  const deps = buildPipelineDeps();
  const pipeline = new FullIngestionPipeline(normalizers, deps);
  const rateLimiter = new PerDomainRateLimiter(source.rateLimitRpm);
  const circuitBreaker = new SourceCircuitBreaker(5, 300_000);

  // 4. Launch browser
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: DEFAULT_BROWSER_CONTEXT_CONFIG.viewport,
      locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
      timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
      userAgent: DEFAULT_BROWSER_CONTEXT_CONFIG.userAgent,
      javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
    });

    const page = await context.newPage();

    // 5. Build discovery URLs
    const profile: CrawlProfile = {
      name: 'willhaben-cli-scrape',
      sourceCode: 'willhaben',
      maxPages,
      sortOrder: 'published_desc',
    };
    const discoveryPlans = await adapter.buildDiscoveryRequests(profile);

    log.info(`Discovery: ${discoveryPlans.length} page(s) to fetch`);

    // 6. Discovery phase
    const allDiscoveredItems: Array<{
      detailUrl: string;
      title: string;
      externalId?: string;
      discoveryUrl: string;
    }> = [];

    for (const plan of discoveryPlans) {
      if (circuitBreaker.isOpen('willhaben')) {
        log.warn('Circuit breaker open, stopping discovery');
        break;
      }

      try {
        await rateLimiter.waitForSlot('willhaben');
        await pageNavigationDelay();

        log.info(`Fetching discovery page: ${plan.url}`);
        await page.goto(plan.url, { waitUntil: 'networkidle', timeout: 30_000 });

        const html = await page.content();
        runCtx.incrementMetric('pagesFetched');
        runCtx.incrementMetric('http2xx');

        const discoveryResult = await adapter.extractDiscoveryPage({
          page,
          requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
          profile,
          scrapeRunId: run.id,
        });

        for (const item of discoveryResult.items) {
          allDiscoveredItems.push({
            detailUrl: item.detailUrl,
            title: item.summaryPayload.titleRaw ?? 'Unknown',
            externalId: item.externalId ?? undefined,
            discoveryUrl: plan.url,
          });
        }

        runCtx.incrementMetric('listingsDiscovered', discoveryResult.items.length);
        circuitBreaker.recordSuccess('willhaben');

        log.info(`Discovered ${discoveryResult.items.length} items from page ${(plan.metadata as Record<string, unknown>)?.page ?? '?'}`);
      } catch (err) {
        const errorClass = classifyScraperError(err);
        circuitBreaker.recordFailure('willhaben', errorClass);
        log.error(`Discovery page failed: ${plan.url}`, { errorClass });

        if (errorClass === 'terminal_page') continue;
        runCtx.incrementMetric('http4xx');
      }
    }

    log.info(`Total discovered: ${allDiscoveredItems.length} listings`);

    // 7. Detail phase
    let ingested = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of allDiscoveredItems) {
      if (circuitBreaker.isOpen('willhaben')) {
        log.warn('Circuit breaker open, stopping detail scraping');
        break;
      }

      try {
        await rateLimiter.waitForSlot('willhaben');
        await pageNavigationDelay();

        const detailUrl = item.detailUrl.startsWith('http')
          ? item.detailUrl
          : `https://www.willhaben.at${item.detailUrl}`;

        log.info(`Fetching detail: ${detailUrl}`);
        await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30_000 });

        const html = await page.content();
        runCtx.incrementMetric('http2xx');

        // Extract detail
        const detailCapture = await adapter.extractDetailPage({
          page,
          requestPlan: { url: detailUrl, metadata: { html } },
          sourceCode: 'willhaben',
          scrapeRunId: run.id,
        });

        // Set sourceListingKeyCandidate
        detailCapture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(detailCapture);
        detailCapture.discoveryUrl = item.discoveryUrl;

        if (dryRun) {
          log.info(`[DRY RUN] Parsed: ${detailCapture.payload.titleRaw ?? item.title}`);
          ingested++;
          continue;
        }

        // Feed through pipeline
        const result = await pipeline.ingestDetailCapture(detailCapture, source.id, run.id);

        const status = result.normalization.isNew ? 'NEW' : 'UPDATED';
        const score = result.scoring?.overallScore ?? null;

        log.info(`${status}: ${detailCapture.payload.titleRaw ?? item.title}`, {
          listingId: result.normalization.listingId,
          score,
        });

        circuitBreaker.recordSuccess('willhaben');
        ingested++;
      } catch (err) {
        const errorClass = classifyScraperError(err);
        circuitBreaker.recordFailure('willhaben', errorClass);

        if (errorClass === 'terminal_page') {
          log.warn(`Terminal: ${item.detailUrl} — skipping`);
          skipped++;
        } else {
          log.error(`Failed: ${item.detailUrl}`, {
            errorClass,
            error: err instanceof Error ? err.message : String(err),
          });
          failed++;
        }
      }
    }

    // 8. Finish scrape run
    const metrics = runCtx.getMetrics();
    const finalStatus = failed > 0 ? 'partial' : 'succeeded';

    await scrapeRuns.finish(run.id, finalStatus, metrics);

    // 9. Print summary
    const duration = runCtx.getDurationFormatted();
    console.log('\n=== Scrape Summary ===');
    console.log(`Duration:     ${duration}`);
    console.log(`Discovered:   ${allDiscoveredItems.length}`);
    console.log(`Ingested:     ${ingested}`);
    console.log(`Skipped:      ${skipped}`);
    console.log(`Failed:       ${failed}`);
    console.log(`Pages:        ${metrics.pagesFetched}`);
    console.log(`Run ID:       ${run.id}`);
    console.log(`Status:       ${finalStatus}`);
    console.log('=====================\n');
  } finally {
    // 10. Cleanup
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await closePool();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
