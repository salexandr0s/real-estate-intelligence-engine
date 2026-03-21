#!/usr/bin/env npx tsx
/**
 * CLI scrape-and-ingest script.
 *
 * Launches Playwright, scrapes discovery + detail pages for any registered source,
 * and feeds captures through the FullIngestionPipeline.
 *
 * Usage:
 *   npx tsx scripts/scrape-and-ingest.ts [--source <code>] [--max-pages N] [--dry-run]
 *
 * Default source: willhaben
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';
import {
  PerDomainRateLimiter,
  SourceCircuitBreaker,
  ScrapeRunContext,
  pageNavigationDelay,
  classifyScraperError,
  dismissCookieConsent,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
} from '@rei/scraper-core';
import { getAdapter } from '../apps/worker-scraper/src/adapter-registry.js';
import { createPipeline } from '../apps/worker-processing/src/pipeline-factory.js';
import type { CrawlProfile } from '@rei/contracts';
import {
  sources,
  scrapeRuns,
  closePool,
} from '@rei/db';

const log = createLogger('scrape-cli');

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { sourceCode: string; maxPages: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let sourceCode = 'willhaben';
  let maxPages = 3;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
    }
    if (args[i] === '--max-pages' && args[i + 1]) {
      maxPages = parseInt(args[i + 1]!, 10);
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { sourceCode, maxPages, dryRun };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sourceCode, maxPages, dryRun } = parseArgs();
  loadConfig();

  log.info('Starting scrape-and-ingest', { sourceCode, maxPages, dryRun });

  // 1. Look up source
  const source = await sources.findByCode(sourceCode);
  if (!source) {
    log.error(`Source "${sourceCode}" not found in sources table. Run db:seed first.`);
    process.exit(1);
  }

  // 2. Get adapter from registry
  const adapter = getAdapter(sourceCode);

  if (dryRun) {
    log.info('DRY RUN mode — will parse but not persist');
  }

  // 3. Create scrape run
  const run = await scrapeRuns.create({
    sourceId: source.id,
    triggerType: 'manual',
    scope: 'full',
    workerHost: 'cli',
    workerVersion: '1.0.0',
    browserType: 'chromium',
  });
  await scrapeRuns.start(run.id);

  const runCtx = new ScrapeRunContext(run.id, sourceCode);

  // 4. Setup pipeline, rate limiter, circuit breaker
  const pipeline = createPipeline();
  const rateLimiter = new PerDomainRateLimiter(source.rateLimitRpm ?? 12);
  const circuitBreaker = new SourceCircuitBreaker(5, 300_000);

  // 5. Build crawl profile from source config
  const sourceConfig = source.config as Record<string, unknown> | null;
  const crawlConfig = sourceConfig?.crawlProfile as Record<string, unknown> | undefined;
  const profile: CrawlProfile = {
    name: `${sourceCode}-cli-scrape`,
    sourceCode,
    maxPages,
    operationType: (crawlConfig?.operationType as string) ?? undefined,
    propertyType: (crawlConfig?.propertyType as string) ?? undefined,
    regions: (crawlConfig?.regions as string[]) ?? undefined,
    sortOrder: (crawlConfig?.sortOrder as string) ?? 'published_desc',
  };

  // 6. Launch browser
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

    // 7. Discovery phase
    const discoveryPlans = await adapter.buildDiscoveryRequests(profile);
    log.info(`Discovery: ${discoveryPlans.length} page(s) to fetch`);

    const allDiscoveredItems: Array<{
      detailUrl: string;
      title: string;
      externalId?: string;
      discoveryUrl: string;
    }> = [];

    for (const plan of discoveryPlans) {
      if (circuitBreaker.isOpen(sourceCode)) {
        log.warn('Circuit breaker open, stopping discovery');
        break;
      }

      try {
        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();

        log.info(`Fetching discovery page: ${plan.url}`);
        await page.goto(plan.url, { waitUntil: 'networkidle', timeout: 30_000 });
        await dismissCookieConsent(page, sourceCode);

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
          const payload = item.summaryPayload as Record<string, unknown>;
          allDiscoveredItems.push({
            detailUrl: item.detailUrl,
            title: (payload.titleRaw as string) ?? 'Unknown',
            externalId: item.externalId ?? undefined,
            discoveryUrl: plan.url,
          });
        }

        runCtx.incrementMetric('listingsDiscovered', discoveryResult.items.length);
        circuitBreaker.recordSuccess(sourceCode);

        log.info(`Discovered ${discoveryResult.items.length} items from page ${(plan.metadata as Record<string, unknown>)?.page ?? '?'}`);
      } catch (err) {
        const errorClass = classifyScraperError(err);
        circuitBreaker.recordFailure(sourceCode, errorClass);
        log.error(`Discovery page failed: ${plan.url}`, { errorClass });

        if (errorClass === 'terminal_page') continue;
        runCtx.incrementMetric('http4xx');
      }
    }

    log.info(`Total discovered: ${allDiscoveredItems.length} listings`);

    // 8. Detail phase
    let ingested = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of allDiscoveredItems) {
      if (circuitBreaker.isOpen(sourceCode)) {
        log.warn('Circuit breaker open, stopping detail scraping');
        break;
      }

      try {
        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();

        // Use adapter's buildDetailRequest for URL resolution
        const detailRequest = await adapter.buildDetailRequest({
          detailUrl: item.detailUrl,
          sourceCode,
          summaryPayload: {},
          discoveredAt: new Date().toISOString(),
        });
        const detailUrl = detailRequest?.url ?? item.detailUrl;

        log.info(`Fetching detail: ${detailUrl}`);
        await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 30_000 });
        await dismissCookieConsent(page, sourceCode);

        const html = await page.content();
        runCtx.incrementMetric('http2xx');

        // Extract detail
        const detailCapture = await adapter.extractDetailPage({
          page,
          requestPlan: { url: detailUrl, metadata: { html } },
          sourceCode,
          scrapeRunId: run.id,
        });

        // Set sourceListingKeyCandidate
        detailCapture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(detailCapture);
        detailCapture.discoveryUrl = item.discoveryUrl;

        const payload = detailCapture.payload as Record<string, unknown>;
        const title = (payload.titleRaw as string) ?? item.title;

        if (dryRun) {
          log.info(`[DRY RUN] Parsed: ${title}`);
          ingested++;
          continue;
        }

        // Feed through pipeline
        const result = await pipeline.ingestDetailCapture(detailCapture, source.id, run.id);

        const status = result.normalization.isNew ? 'NEW' : 'UPDATED';
        const score = result.scoring?.overallScore ?? null;

        log.info(`${status}: ${title}`, {
          listingId: result.normalization.listingId,
          score,
        });

        circuitBreaker.recordSuccess(sourceCode);
        ingested++;
      } catch (err) {
        const errorClass = classifyScraperError(err);
        circuitBreaker.recordFailure(sourceCode, errorClass);

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

    // 9. Finish scrape run
    const metrics = runCtx.getMetrics();
    const finalStatus = ingested === 0 && failed > 0 ? 'failed' : failed > 0 ? 'partial' : 'succeeded';

    await scrapeRuns.finish(run.id, finalStatus, metrics);

    // 10. Print summary
    const duration = runCtx.getDurationFormatted();
    console.log('\n=== Scrape Summary ===');
    console.log(`Source:       ${sourceCode}`);
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
    // 11. Cleanup
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await closePool();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
