#!/usr/bin/env npx tsx
/**
 * Canary crawl — lightweight health check for a source adapter.
 *
 * Fetches 1 discovery page and up to 3 detail pages without persisting
 * anything to the database. Reports success/failure rate and exits with
 * code 0 if detail success rate exceeds 80%, code 1 otherwise.
 *
 * Usage:
 *   npx tsx scripts/canary-crawl.ts --source <code> [--pages 1]
 *
 * Examples:
 *   npx tsx scripts/canary-crawl.ts --source willhaben
 *   npx tsx scripts/canary-crawl.ts --source immoscout24 --pages 2
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import {
  PerDomainRateLimiter,
  pageNavigationDelay,
  classifyScraperError,
  dismissCookieConsent,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  pickRandomViewport,
  pickRandomUserAgent,
  setupRequestInterception,
} from '@immoradar/scraper-core';
import type { CrawlProfile } from '@immoradar/contracts';
import { getAdapter } from '../apps/worker-scraper/src/adapter-registry.js';

const log = createLogger('canary-crawl');

const SUCCESS_THRESHOLD = 0.8;
const MAX_DETAIL_SAMPLES = 3;

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { sourceCode: string; pages: number } {
  const args = process.argv.slice(2);
  let sourceCode = '';
  let pages = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
    }
    if (args[i] === '--pages' && args[i + 1]) {
      pages = parseInt(args[i + 1]!, 10);
      i++;
    }
  }

  if (!sourceCode) {
    console.error('Usage: npx tsx scripts/canary-crawl.ts --source <code> [--pages 1]');
    process.exit(1);
  }

  return { sourceCode, pages };
}

// ── Main ────────────────────────────────────────────────────────────────────

interface CanaryResult {
  sourceCode: string;
  discoveryPages: number;
  listingsFound: number;
  detailAttempted: number;
  detailSucceeded: number;
  detailFailed: number;
  successRate: number;
  errors: string[];
  durationMs: number;
}

async function main(): Promise<void> {
  const { sourceCode, pages } = parseArgs();
  loadConfig();

  log.info('Starting canary crawl', { sourceCode, pages });

  // Validate adapter exists
  let adapter;
  try {
    adapter = getAdapter(sourceCode);
  } catch {
    console.error(`No adapter registered for source: ${sourceCode}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const rateLimiter = new PerDomainRateLimiter(12);
  const errors: string[] = [];

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  let discoveryPages = 0;
  let listingsFound = 0;
  let detailAttempted = 0;
  let detailSucceeded = 0;
  let detailFailed = 0;

  try {
    const config = loadConfig();
    const viewport = pickRandomViewport();
    const userAgent = pickRandomUserAgent();

    browser = await chromium.launch({ headless: config.playwright.headless });
    context = await browser.newContext({
      viewport,
      locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
      timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
      userAgent,
      javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
    });
    await setupRequestInterception(context);

    const page = await context.newPage();

    // ── Discovery phase ──────────────────────────────────────────────────

    const profile: CrawlProfile = {
      name: `${sourceCode}-canary`,
      sourceCode,
      maxPages: pages,
      sortOrder: 'published_desc',
    };

    const discoveryPlans = await adapter.buildDiscoveryRequests(profile);
    log.info(`Discovery: ${discoveryPlans.length} page(s) to fetch`);

    const discoveredItems: Array<{ detailUrl: string; discoveryUrl: string }> = [];

    for (const plan of discoveryPlans) {
      try {
        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();

        log.info(`Fetching discovery page: ${plan.url}`);
        await page.goto(plan.url, { waitUntil: 'networkidle', timeout: 30_000 });
        await dismissCookieConsent(page, sourceCode);

        const html = await page.content();
        discoveryPages++;

        const result = await adapter.extractDiscoveryPage({
          page,
          requestPlan: { ...plan, metadata: { ...plan.metadata, html } },
          profile,
          scrapeRunId: 0, // Not persisting, use dummy ID
        });

        for (const item of result.items) {
          discoveredItems.push({
            detailUrl: item.detailUrl,
            discoveryUrl: plan.url,
          });
        }

        listingsFound += result.items.length;
        log.info(`Discovered ${result.items.length} items`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Discovery failed: ${msg}`);
        log.error('Discovery page failed', { url: plan.url, error: msg });
      }
    }

    // ── Detail phase (sample up to MAX_DETAIL_SAMPLES) ──────────────────

    const sampled = discoveredItems.slice(0, MAX_DETAIL_SAMPLES);
    log.info(`Detail: sampling ${sampled.length} of ${discoveredItems.length} listings`);

    for (const item of sampled) {
      detailAttempted++;
      try {
        await rateLimiter.waitForSlot(sourceCode);
        await pageNavigationDelay();

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

        const capture = await adapter.extractDetailPage({
          page,
          requestPlan: { url: detailUrl, metadata: { html } },
          sourceCode,
          scrapeRunId: 0,
        });

        const payload = capture.payload as Record<string, unknown>;
        const title = (payload.titleRaw as string) ?? 'Unknown';
        log.info(`Detail OK: ${title}`);

        detailSucceeded++;
      } catch (err) {
        const errorClass = classifyScraperError(err);
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Detail failed (${errorClass}): ${msg}`);
        log.error('Detail extraction failed', {
          url: item.detailUrl,
          errorClass,
          error: msg,
        });
        detailFailed++;
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const durationMs = Date.now() - startTime;
  const successRate = detailAttempted > 0 ? detailSucceeded / detailAttempted : 0;

  const result: CanaryResult = {
    sourceCode,
    discoveryPages,
    listingsFound,
    detailAttempted,
    detailSucceeded,
    detailFailed,
    successRate,
    errors,
    durationMs,
  };

  // ── Report ──────────────────────────────────────────────────────────────

  console.log('\n=== Canary Crawl Report ===');
  console.log(`Source:           ${result.sourceCode}`);
  console.log(`Duration:         ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Discovery pages:  ${result.discoveryPages}`);
  console.log(`Listings found:   ${result.listingsFound}`);
  console.log(`Detail attempted: ${result.detailAttempted}`);
  console.log(`Detail succeeded: ${result.detailSucceeded}`);
  console.log(`Detail failed:    ${result.detailFailed}`);
  console.log(`Success rate:     ${(result.successRate * 100).toFixed(0)}%`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    for (const e of result.errors) {
      console.log(`  - ${e}`);
    }
  }

  const passed = result.successRate >= SUCCESS_THRESHOLD;
  console.log(`\nResult:           ${passed ? 'PASS' : 'FAIL'}`);
  console.log('===========================\n');

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
