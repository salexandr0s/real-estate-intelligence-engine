#!/usr/bin/env npx tsx
/**
 * Ingestion pipeline orchestrator.
 *
 * Two modes:
 *   bootstrap — Full setup from scratch: fetch POIs, scrape all sources, geocode,
 *               compute baselines, score, backfill POI distances, fingerprint, cluster.
 *               Run once on a fresh DB or after major schema changes.
 *
 *   daily     — Incremental update: scrape all sources, geocode new listings,
 *               refresh baselines + scores, compute POI distances for new listings,
 *               update fingerprints + clusters.
 *               Designed to run on a schedule (every 12h or 24h).
 *
 * Usage:
 *   npx tsx scripts/run-pipeline.ts --mode bootstrap         # Full setup from scratch
 *   npx tsx scripts/run-pipeline.ts --mode daily             # Incremental (default)
 *   npx tsx scripts/run-pipeline.ts --sources willhaben      # Single source
 *   npx tsx scripts/run-pipeline.ts --sources willhaben,wohnnet
 *   npx tsx scripts/run-pipeline.ts --max-pages 50           # Limit discovery pages
 *   npx tsx scripts/run-pipeline.ts --skip-scrape            # Post-processing only
 *   npx tsx scripts/run-pipeline.ts --dry-run                # Preview
 *   npx tsx scripts/run-pipeline.ts --stage geocode          # Single stage
 */

import { chromium } from 'playwright';
import type { Browser } from 'playwright';

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import {
  PerDomainRateLimiter,
  SourceCircuitBreaker,
  ScrapeRunContext,
  pageNavigationDelay,
  classifyScraperError,
  dismissCookieConsent,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  ArtifactWriter,
  pickRandomViewport,
  pickRandomUserAgent,
  setupRequestInterception,
} from '@immoradar/scraper-core';
import { getAdapter } from '../apps/worker-scraper/src/adapter-registry.js';
import { createPipeline } from '../apps/worker-processing/src/pipeline-factory.js';
import type { CrawlProfile, RequestPlan } from '@immoradar/contracts';
import { sources, scrapeRuns, listings, query, listingPois, closePool } from '@immoradar/db';
import { geocodeListing } from '@immoradar/geocoding';

const log = createLogger('pipeline');

// ── CLI args ────────────────────────────────────────────────────────────────

type Mode = 'bootstrap' | 'daily';

interface PipelineArgs {
  mode: Mode;
  sources: string[] | null; // null = all active
  maxPages: number;
  dryRun: boolean;
  skipScrape: boolean;
  stage: string | null; // run only this stage
}

const STAGES = [
  'fetch-pois',
  'scrape',
  'geocode',
  'baselines',
  'rescore',
  'pois',
  'fingerprints',
  'clusters',
] as const;
type Stage = (typeof STAGES)[number];

// Stages included in each mode
const MODE_STAGES: Record<Mode, Set<Stage>> = {
  bootstrap: new Set([
    'fetch-pois',
    'scrape',
    'geocode',
    'baselines',
    'rescore',
    'pois',
    'fingerprints',
    'clusters',
  ]),
  daily: new Set(['scrape', 'geocode', 'baselines', 'rescore', 'pois', 'fingerprints', 'clusters']),
};

function parseArgs(): PipelineArgs {
  const args = process.argv.slice(2);
  const result: PipelineArgs = {
    mode: 'daily',
    sources: null,
    maxPages: 100,
    dryRun: false,
    skipScrape: false,
    stage: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === '--mode' && next) {
      if (next !== 'bootstrap' && next !== 'daily') {
        console.error(`Invalid mode: ${next}. Use "bootstrap" or "daily".`);
        process.exit(1);
      }
      result.mode = next;
      i++;
    } else if (arg === '--sources' && next) {
      result.sources = next.split(',').map((s) => s.trim());
      i++;
    } else if (arg === '--max-pages' && next) {
      result.maxPages = parseInt(next, 10);
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--skip-scrape') {
      result.skipScrape = true;
    } else if (arg === '--stage' && next) {
      result.stage = next;
      i++;
    }
  }

  return result;
}

// ── Stage: Scrape ───────────────────────────────────────────────────────────

async function runScrape(
  sourceCodes: string[],
  maxPages: number,
  dryRun: boolean,
): Promise<{ discovered: number; ingested: number; failed: number }> {
  const totals = { discovered: 0, ingested: 0, failed: 0 };
  const config = loadConfig();
  const pipeline = createPipeline();
  const artifactWriter = new ArtifactWriter(config.s3.bucket);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: config.playwright.headless });

    for (const sourceCode of sourceCodes) {
      const source = await sources.findByCode(sourceCode);
      if (!source) {
        log.warn(`Source "${sourceCode}" not found, skipping`);
        continue;
      }
      if (!source.isActive) {
        log.warn(`Source "${sourceCode}" is not active, skipping`);
        continue;
      }

      log.info(`[scrape] Starting: ${sourceCode}`);

      const adapter = getAdapter(sourceCode);
      const run = await scrapeRuns.create({
        sourceId: source.id,
        triggerType: 'schedule',
        scope: 'full',
        workerHost: 'pipeline-cli',
        workerVersion: '1.0.0',
        browserType: 'chromium',
      });
      await scrapeRuns.start(run.id);

      const runCtx = new ScrapeRunContext(run.id, sourceCode);
      const rateLimiter = new PerDomainRateLimiter(source.rateLimitRpm ?? 12);
      const circuitBreaker = new SourceCircuitBreaker(5, 300_000);

      const sourceConfig = source.config as Record<string, unknown> | null;
      const crawlConfig = sourceConfig?.crawlProfile as Record<string, unknown> | undefined;
      const profile: CrawlProfile = {
        name: `${sourceCode}-pipeline`,
        sourceCode,
        maxPages: 1,
        maxPagesPerRun: maxPages,
        operationType: (crawlConfig?.operationType as string) ?? undefined,
        propertyType: (crawlConfig?.propertyType as string) ?? undefined,
        regions: (crawlConfig?.regions as string[]) ?? undefined,
        sortOrder: (crawlConfig?.sortOrder as string) ?? 'published_desc',
      };

      const viewport = pickRandomViewport();
      const userAgent = pickRandomUserAgent();
      const context = await browser.newContext({
        viewport,
        locale: DEFAULT_BROWSER_CONTEXT_CONFIG.locale,
        timezoneId: DEFAULT_BROWSER_CONTEXT_CONFIG.timezoneId,
        userAgent,
        javaScriptEnabled: DEFAULT_BROWSER_CONTEXT_CONFIG.javaScriptEnabled,
      });
      await setupRequestInterception(context);
      const page = await context.newPage();

      // Discovery
      const discoveryPlans = await adapter.buildDiscoveryRequests(profile);
      const allItems: Array<{
        detailUrl: string;
        title: string;
        externalId?: string;
        discoveryUrl: string;
      }> = [];

      let currentPlan: RequestPlan | null = discoveryPlans[0] ?? null;
      let pagesProcessed = 0;

      while (currentPlan && pagesProcessed < maxPages) {
        if (circuitBreaker.isOpen(sourceCode)) break;

        try {
          await rateLimiter.waitForSlot(sourceCode);
          await pageNavigationDelay();

          log.info(`[scrape:${sourceCode}] Discovery page ${pagesProcessed + 1}`);
          await page.goto(currentPlan.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          if (currentPlan.waitForSelector) {
            await page
              .waitForSelector(currentPlan.waitForSelector, {
                timeout: currentPlan.waitForTimeout ?? 10_000,
              })
              .catch(() => {});
          }
          await dismissCookieConsent(page, sourceCode);

          runCtx.incrementMetric('pagesFetched');
          runCtx.incrementMetric('http2xx');
          pagesProcessed++;

          const discoveryResult = await adapter.extractDiscoveryPage({
            page,
            requestPlan: {
              ...currentPlan,
              metadata: { ...currentPlan.metadata, html: await page.content() },
            },
            profile,
            scrapeRunId: run.id,
          });

          for (const item of discoveryResult.items) {
            const payload = item.summaryPayload as Record<string, unknown>;
            allItems.push({
              detailUrl: item.detailUrl,
              title: (payload.titleRaw as string) ?? 'Unknown',
              externalId: item.externalId ?? undefined,
              discoveryUrl: currentPlan.url,
            });
          }

          runCtx.incrementMetric('listingsDiscovered', discoveryResult.items.length);
          circuitBreaker.recordSuccess(sourceCode);

          currentPlan = discoveryResult.nextPagePlan;
          if (discoveryResult.items.length === 0) currentPlan = null;
        } catch (err) {
          const errorClass = classifyScraperError(err);
          circuitBreaker.recordFailure(sourceCode, errorClass);
          log.error(`[scrape:${sourceCode}] Discovery failed`, { errorClass });
          runCtx.incrementMetric('http4xx');
          currentPlan = null;
        }
      }

      totals.discovered += allItems.length;
      log.info(
        `[scrape:${sourceCode}] Discovered ${allItems.length} across ${pagesProcessed} pages`,
      );

      // Detail scraping + ingestion
      let ingested = 0;
      let failed = 0;

      for (const item of allItems) {
        if (circuitBreaker.isOpen(sourceCode)) break;

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

          await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          if (detailRequest?.waitForSelector) {
            await page
              .waitForSelector(detailRequest.waitForSelector, {
                timeout: detailRequest.waitForTimeout ?? 10_000,
              })
              .catch(() => {});
          }
          await dismissCookieConsent(page, sourceCode);

          const html = await page.content();
          runCtx.incrementMetric('http2xx');

          let htmlKey: string | undefined;
          try {
            htmlKey = await artifactWriter.writeHtml(sourceCode, String(run.id), detailUrl, html);
          } catch {
            // Non-critical
          }

          const detailCapture = await adapter.extractDetailPage({
            page,
            requestPlan: { url: detailUrl, metadata: { html } },
            sourceCode,
            scrapeRunId: run.id,
          });

          detailCapture.sourceListingKeyCandidate = adapter.deriveSourceListingKey(detailCapture);
          detailCapture.discoveryUrl = item.discoveryUrl;
          detailCapture.htmlStorageKey = htmlKey ?? null;

          if (dryRun) {
            ingested++;
            continue;
          }

          await pipeline.ingestDetailCapture(detailCapture, source.id, run.id);
          circuitBreaker.recordSuccess(sourceCode);
          ingested++;

          if (ingested % 50 === 0) {
            log.info(`[scrape:${sourceCode}] Progress: ${ingested}/${allItems.length}`);
          }
        } catch (err) {
          const errorClass = classifyScraperError(err);
          circuitBreaker.recordFailure(sourceCode, errorClass);
          failed++;
        }
      }

      totals.ingested += ingested;
      totals.failed += failed;

      const metrics = runCtx.getMetrics();
      const finalStatus =
        ingested === 0 && failed > 0 ? 'failed' : failed > 0 ? 'partial' : 'succeeded';
      await scrapeRuns.finish(run.id, finalStatus, metrics);

      log.info(`[scrape:${sourceCode}] Done: ${ingested} ingested, ${failed} failed`);

      await context.close().catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return totals;
}

// ── Stage: Geocode ──────────────────────────────────────────────────────────

async function runGeocode(dryRun: boolean): Promise<number> {
  log.info('[geocode] Finding listings without coordinates...');

  const needGeocoding = await listings.findListingsNeedingGeocoding(500);
  log.info(`[geocode] Found ${needGeocoding.length} listings needing geocoding`);

  if (needGeocoding.length === 0) return 0;

  let geocoded = 0;
  let errors = 0;

  for (const listing of needGeocoding) {
    try {
      const address = [listing.street, listing.houseNumber].filter(Boolean).join(' ') || null;
      const result = await geocodeListing({
        listingId: listing.id,
        address,
        postalCode: listing.postalCode ?? null,
        city: listing.city ?? 'Wien',
        districtNo: listing.districtNo ?? null,
        existingLatitude: null,
        existingLongitude: null,
        existingPrecision: null,
        title: listing.title ?? null,
        description: listing.description ?? null,
        addressDisplay: listing.addressDisplay ?? null,
      });

      if (result && !dryRun) {
        await listings.updateCoordinates(
          listing.id,
          result.latitude,
          result.longitude,
          result.geocodePrecision,
          result.source,
        );
        geocoded++;
      }

      // Nominatim rate limit: 1 req/sec
      await new Promise((r) => setTimeout(r, 1100));
    } catch (_err) {
      errors++;
      if (errors > 10) {
        log.warn('[geocode] Too many errors, stopping');
        break;
      }
    }
  }

  log.info(`[geocode] Done: ${geocoded} geocoded, ${errors} errors`);
  return geocoded;
}

// ── Stage: Baselines ────────────────────────────────────────────────────────

async function runBaselines(): Promise<number> {
  log.info('[baselines] Computing market baselines...');
  return runScript('compute-baselines.ts', '');
}

// ── Shared: run existing script ─────────────────────────────────────────────

function runScript(script: string, extraArgs: string): number {
  const { execSync } = require('node:child_process');
  try {
    const output = execSync(`npx tsx scripts/${script} ${extraArgs}`.trim(), {
      cwd: process.cwd(),
      encoding: 'utf8' as const,
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    // Try to extract a count from common output patterns
    const match =
      output.match(/(?:Rescored|Upserted|Created|Done|Geocoded|Computed)[\s:]+(\d+)/i) ??
      output.match(/(\d+)\s+(?:baselines|clusters|listings|geocoded)/i);
    return match ? parseInt(match[1]!, 10) : 0;
  } catch (err) {
    log.error(`[${script}] Failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// ── Stage: Rescore ──────────────────────────────────────────────────────────

async function runRescore(dryRun: boolean): Promise<number> {
  log.info('[rescore] Rescoring all active listings...');
  return runScript('rescore-listings.ts', dryRun ? '--dry-run' : '');
}

// ── Stage: POI distances ────────────────────────────────────────────────────

async function runPoisBackfill(): Promise<number> {
  log.info('[pois] Computing POI distances for geocoded listings...');

  interface ListingCoord {
    id: string;
    latitude: string;
    longitude: string;
  }

  const rows = await query<ListingCoord>(
    `SELECT l.id, l.latitude, l.longitude FROM listings l
     WHERE l.listing_status = 'active' AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM listing_pois lp WHERE lp.listing_id = l.id)`,
  );

  log.info(`[pois] Found ${rows.length} listings missing POI data`);
  if (rows.length === 0) return 0;

  let done = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await listingPois.computeAndCache(
        Number(row.id),
        parseFloat(row.latitude),
        parseFloat(row.longitude),
      );
      done++;
      if (done % 50 === 0) log.info(`[pois] Progress: ${done}/${rows.length}`);
    } catch {
      errors++;
    }
  }

  log.info(`[pois] Done: ${done} listings cached, ${errors} errors`);
  return done;
}

// ── Stage: Clusters ─────────────────────────────────────────────────────────

async function runClusters(dryRun: boolean): Promise<number> {
  log.info('[clusters] Building cross-source clusters...');
  return runScript('build-clusters.ts', dryRun ? '--dry-run' : '');
}

// ── Stage: Fetch & import POIs (bootstrap only) ────────────────────────────

async function runFetchPois(): Promise<number> {
  log.info('[fetch-pois] Fetching Vienna POIs from Overpass/Wien APIs...');
  runScript('fetch-vienna-pois.ts', '');
  log.info('[fetch-pois] Importing POIs into database...');
  return runScript('import-pois-to-db.ts', '');
}

// ── Orchestrator ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  loadConfig();

  const startTime = Date.now();
  const modeStages = MODE_STAGES[args.mode];
  const stageList = STAGES.filter((s) => modeStages.has(s));

  log.info(`Pipeline starting [${args.mode}]`, {
    mode: args.mode,
    stages: args.stage ?? stageList.join(' → '),
    sources: args.sources ?? 'all active',
    maxPages: args.maxPages,
    dryRun: args.dryRun,
  });

  // Resolve source list
  let sourceCodes: string[];
  if (args.sources) {
    sourceCodes = args.sources;
  } else {
    const allSources = await query<{ code: string }>(
      `SELECT code FROM sources WHERE is_active = true ORDER BY priority DESC NULLS LAST, code`,
    );
    sourceCodes = allSources.map((s) => s.code);
  }

  const shouldRun = (stage: Stage): boolean => {
    if (args.stage) return args.stage === stage;
    if (stage === 'scrape' && args.skipScrape) return false;
    return modeStages.has(stage);
  };

  const activeStages = stageList.filter((s) => shouldRun(s));
  const total = activeStages.length;
  let step = 0;

  const summary: Record<string, string> = {};

  try {
    // Fetch POIs (bootstrap only)
    if (shouldRun('fetch-pois')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Fetch POIs ═══`);
      const n = await runFetchPois();
      summary['Fetch POIs'] = `${n} POIs imported`;
    }

    // Scrape
    if (shouldRun('scrape')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Scrape ═══`);
      const r = await runScrape(sourceCodes, args.maxPages, args.dryRun);
      summary['Scrape'] = `${r.ingested} ingested, ${r.failed} failed (${r.discovered} discovered)`;
    }

    // Geocode
    if (shouldRun('geocode')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Geocode ═══`);
      const n = await runGeocode(args.dryRun);
      summary['Geocode'] = `${n} listings geocoded`;
    }

    // Baselines
    if (shouldRun('baselines')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Baselines ═══`);
      const n = await runBaselines();
      summary['Baselines'] = `${n} baselines upserted`;
    }

    // Rescore
    if (shouldRun('rescore')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Rescore ═══`);
      const n = await runRescore(args.dryRun);
      summary['Rescore'] = `${n} listings rescored`;
    }

    // POI distances (only for listings missing them — fast for daily)
    if (shouldRun('pois')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: POI Distances ═══`);
      const n = await runPoisBackfill();
      summary['POIs'] = `${n} listings cached`;
    }

    // Fingerprints
    if (shouldRun('fingerprints')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Fingerprints ═══`);
      const n = runScript('backfill-fingerprints.ts', '');
      summary['Fingerprints'] = `${n} listings fingerprinted`;
    }

    // Clusters
    if (shouldRun('clusters')) {
      step++;
      log.info(`═══ Stage ${step}/${total}: Clusters ═══`);
      const n = await runClusters(args.dryRun);
      summary['Clusters'] = `${n} clusters built`;
    }
  } finally {
    await closePool();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log(`\n╔════════════════════════════════════╗`);
  console.log(`║  Pipeline Complete [${args.mode.padEnd(10)}]   ║`);
  console.log(`╠════════════════════════════════════╣`);
  for (const [stage, result] of Object.entries(summary)) {
    console.log(`║ ${stage.padEnd(14)} ${result}`);
  }
  console.log(`║ Duration       ${elapsed}s`);
  if (args.dryRun) console.log('║ DRY RUN — nothing persisted');
  console.log('╚════════════════════════════════════╝\n');
}

main().catch((err) => {
  log.error('Pipeline fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
