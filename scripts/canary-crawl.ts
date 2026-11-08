#!/usr/bin/env npx tsx
/**
 * Canary crawl: a quick health check for one source adapter. Writes nothing to the database.
 *
 * Fetches up to --pages list pages, following each page's next-page plan, then up to 3 detail
 * pages. For each list page it prints the HTTP status, whether the plan's selector was found and
 * how many listings the parser found. For each detail page it prints the status, the selector,
 * the key from the list page against the key derived from the detail page, the extraction status,
 * the availability, the title, the price, the area, rooms, postcode and district, and whether the
 * page gave coordinates. Exits 0 when at least 80% of the detail pages were captured, 1 otherwise.
 *
 * Usage:
 *   npx tsx scripts/canary-crawl.ts --source <code> [--pages <n>]
 *
 * Examples:
 *   npx tsx scripts/canary-crawl.ts --source willhaben
 *   npx tsx scripts/canary-crawl.ts --source immoscout24 --pages 2
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

import { loadCanaryConfig } from '@immoradar/config';
import {
  PerDomainRateLimiter,
  pageNavigationDelay,
  classifyScraperError,
  isChallengePage,
  navigateForCapture,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  pickRandomViewport,
  pickRandomUserAgent,
  setupRequestInterception,
  type CaptureNavigation,
} from '@immoradar/scraper-core';
import type { CrawlProfile, DiscoveryItem, RequestPlan, SourceAdapter } from '@immoradar/contracts';
import { getAdapter } from '../apps/worker-scraper/src/adapter-registry.js';
import { BlockedPageError } from '../apps/worker-scraper/src/page-errors.js';

const SUCCESS_THRESHOLD = 0.8;
const MAX_DETAIL_SAMPLES = 3;
const USAGE = 'Usage: npx tsx scripts/canary-crawl.ts --source <code> [--pages <n>]';

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { sourceCode: string; pages: number } {
  const args = process.argv.slice(2);
  let sourceCode = '';
  let pages = 1;

  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === '--source' && value) {
      sourceCode = value;
      i++;
    } else if (args[i] === '--pages' && value) {
      pages = Number.parseInt(value, 10);
      i++;
    }
  }

  if (!sourceCode || !Number.isInteger(pages) || pages < 1) {
    console.error(USAGE);
    process.exit(1);
  }

  return { sourceCode, pages };
}

// ── Output ──────────────────────────────────────────────────────────────────

function describeNavigation(nav: CaptureNavigation): string {
  const selector = nav.selectorFound === null ? 'none' : nav.selectorFound ? 'hit' : 'miss';
  return `status=${nav.status ?? 'none'} selector=${selector}`;
}

function describeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `FAILED ${classifyScraperError(err)}: ${message}`;
}

// ── Crawl ───────────────────────────────────────────────────────────────────

interface CanaryCounts {
  listPages: number;
  listingsFound: number;
  detailAttempted: number;
  detailCaptured: number;
}

async function crawl(
  context: BrowserContext,
  adapter: SourceAdapter<unknown, unknown>,
  sourceCode: string,
  pages: number,
  navigationTimeoutMs: number,
): Promise<CanaryCounts> {
  const counts: CanaryCounts = {
    listPages: 0,
    listingsFound: 0,
    detailAttempted: 0,
    detailCaptured: 0,
  };
  const rateLimiter = new PerDomainRateLimiter(12);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(navigationTimeoutMs);

  const profile: CrawlProfile = {
    name: `${sourceCode}-canary`,
    sourceCode,
    maxPages: 1, // As in the discovery worker: one seed page, then the parser's next-page plans
    maxPagesPerRun: pages,
    sortOrder: 'published_desc',
  };

  // ── List pages ──────────────────────────────────────────────────────────

  const items: DiscoveryItem<unknown>[] = [];
  let next: RequestPlan | null = (await adapter.buildDiscoveryRequests(profile))[0] ?? null;

  for (let n = 1; next !== null && n <= pages; n++) {
    const plan: RequestPlan = next;
    next = null; // A failed or empty page ends the crawl, as in the discovery worker

    await rateLimiter.waitForSlot(sourceCode);
    await pageNavigationDelay();
    try {
      const nav = await navigateForCapture(page, plan, { sourceCode });
      const html = await page.content();
      // As in the discovery worker, a challenge page fails instead of reading as an empty search.
      if (isChallengePage(html)) throw new BlockedPageError();
      const result = await adapter.extractDiscoveryPage({
        page,
        requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
        profile,
        scrapeRunId: 0, // Nothing is persisted
      });

      counts.listPages++;
      counts.listingsFound += result.items.length;
      items.push(...result.items);
      console.log(
        `list ${n}: ${describeNavigation(nav)} items=${result.items.length} ${nav.finalUrl}`,
      );

      if (result.items.length > 0) next = result.nextPagePlan;
    } catch (err) {
      console.log(`list ${n}: ${describeFailure(err)} ${plan.url}`);
    }
  }

  // ── Detail pages ────────────────────────────────────────────────────────

  for (const [index, item] of items.slice(0, MAX_DETAIL_SAMPLES).entries()) {
    const n = index + 1;
    counts.detailAttempted++;

    await rateLimiter.waitForSlot(sourceCode);
    await pageNavigationDelay();
    try {
      const plan = (await adapter.buildDetailRequest(item)) ?? { url: item.detailUrl };
      const nav = await navigateForCapture(page, plan, { sourceCode });
      const html = await page.content();
      // The same context the detail worker gives the parser
      const detailContext = {
        page,
        requestPlan: { url: plan.url, metadata: { html } },
        sourceCode,
        scrapeRunId: 0,
      };
      const capture = await adapter.extractDetailPage(detailContext);
      const availability = adapter.detectAvailability(detailContext);

      const discoveryKey = item.externalId ? `${sourceCode}:${item.externalId}` : null;
      const detailKey = adapter.deriveSourceListingKey(capture);
      const keys =
        discoveryKey === detailKey
          ? `key=${detailKey} (match)`
          : `key=MISMATCH list=${discoveryKey ?? 'none'} detail=${detailKey}`;
      const payload = (capture.payload ?? {}) as Record<string, unknown>;

      console.log(`detail ${n}: ${describeNavigation(nav)} ${keys} ${nav.finalUrl}`);
      console.log(
        `  extraction=${capture.extractionStatus} availability=${availability.status}` +
          ` title=${JSON.stringify(payload.titleRaw ?? null)}` +
          ` price=${JSON.stringify(payload.priceRaw ?? null)}`,
      );
      console.log(
        `  area=${JSON.stringify(payload.livingAreaRaw ?? null)}` +
          ` rooms=${JSON.stringify(payload.roomsRaw ?? null)}` +
          ` postcode=${JSON.stringify(payload.postalCodeRaw ?? null)}` +
          ` district=${JSON.stringify(payload.districtRaw ?? null)}` +
          ` geo=${payload.latRaw != null && payload.lonRaw != null ? 'yes' : 'no'}`,
      );

      if (capture.extractionStatus === 'captured') counts.detailCaptured++;
    } catch (err) {
      console.log(`detail ${n}: ${describeFailure(err)} ${item.detailUrl}`);
    }
  }

  return counts;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sourceCode, pages } = parseArgs();
  const config = loadCanaryConfig();

  let adapter: SourceAdapter<unknown, unknown>;
  try {
    adapter = getAdapter(sourceCode);
  } catch {
    console.error(`No adapter registered for source: ${sourceCode}`);
    process.exit(1);
  }

  console.log(
    `Canary for ${sourceCode}: up to ${pages} list page(s) and ${MAX_DETAIL_SAMPLES} detail pages\n`,
  );

  const startTime = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let counts: CanaryCounts;

  try {
    browser = await chromium.launch({ headless: config.playwright.headless });
    context = await browser.newContext({
      viewport: pickRandomViewport(),
      locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
      timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
      userAgent: pickRandomUserAgent(),
      javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
    });
    await setupRequestInterception(context);
    counts = await crawl(
      context,
      adapter,
      sourceCode,
      pages,
      config.playwright.navigationTimeoutMs,
    );
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const successRate =
    counts.detailAttempted > 0 ? counts.detailCaptured / counts.detailAttempted : 0;
  const passed = successRate >= SUCCESS_THRESHOLD;

  console.log('\n=== Canary Crawl Report ===');
  console.log(`Source:           ${sourceCode}`);
  console.log(`Duration:         ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`List pages:       ${counts.listPages}`);
  console.log(`Listings found:   ${counts.listingsFound}`);
  console.log(`Detail attempted: ${counts.detailAttempted}`);
  console.log(`Detail captured:  ${counts.detailCaptured}`);
  console.log(`Success rate:     ${(successRate * 100).toFixed(0)}%`);
  console.log(`Result:           ${passed ? 'PASS' : 'FAIL'}`);
  console.log('===========================\n');

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
