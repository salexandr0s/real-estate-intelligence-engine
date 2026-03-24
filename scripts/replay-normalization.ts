#!/usr/bin/env npx tsx
/**
 * Replay normalization for raw listings.
 *
 * Re-runs source normalizers against stored raw_listings payloads and
 * compares the output to existing canonical listings. Optionally upserts
 * changed listings and appends a version with reason 'backfill'.
 *
 * Usage:
 *   npx tsx scripts/replay-normalization.ts [--source <code>] [--limit N] [--dry-run]
 */

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import { query, sources, listings, listingVersions, closePool } from '@immoradar/db';
import {
  BaseSourceMapper,
  WillhabenMapper,
  Immoscout24Mapper,
  WohnnetMapper,
  DerStandardMapper,
  FindMyHomeMapper,
  OpenImmoMapper,
  RemaxMapper,
} from '@immoradar/normalization';
import type {
  SourceRawListingBase,
  NormalizationContext,
  ListingStatus,
} from '@immoradar/contracts';

const log = createLogger('replay-normalize');

// ── Normalizer map (mirrors pipeline-factory.ts) ────────────────────────────

const normalizers = new Map<string, BaseSourceMapper>([
  ['willhaben', new WillhabenMapper()],
  ['immoscout24', new Immoscout24Mapper()],
  ['wohnnet', new WohnnetMapper()],
  ['derstandard', new DerStandardMapper()],
  ['findmyhome', new FindMyHomeMapper()],
  ['openimmo', new OpenImmoMapper()],
  ['remax', new RemaxMapper()],
]);

// ── CLI arg parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  sourceCode: string | null;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let sourceCode: string | null = null;
  let limit = 1000;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
    }
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]!, 10);
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { sourceCode, limit, dryRun };
}

// ── DB row type for raw_listings join ───────────────────────────────────────

interface RawListingJoinRow {
  id: string;
  source_id: string;
  source_listing_key: string;
  external_id: string | null;
  canonical_url: string;
  detail_url: string;
  raw_payload: Record<string, unknown>;
  content_sha256: string;
  last_scrape_run_id: string;
  source_code: string;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sourceCode, limit, dryRun } = parseArgs();
  loadConfig();

  log.info('Starting normalization replay', { sourceCode, limit, dryRun });

  // Resolve source ID if filtered
  let sourceId: number | null = null;
  if (sourceCode) {
    const source = await sources.findByCode(sourceCode);
    if (!source) {
      log.error(`Source "${sourceCode}" not found in sources table.`);
      await closePool();
      process.exit(1);
    }
    sourceId = source.id;
  }

  // Query raw_listings with source code
  const sourceFilter = sourceId != null ? 'AND rl.source_id = $2' : '';
  const params: unknown[] = [limit];
  if (sourceId != null) params.push(sourceId);

  const rawRows = await query<RawListingJoinRow>(
    `SELECT rl.id, rl.source_id, rl.source_listing_key, rl.external_id,
            rl.canonical_url, rl.detail_url, rl.raw_payload, rl.content_sha256,
            rl.last_scrape_run_id, s.code AS source_code
     FROM raw_listings rl
     JOIN sources s ON s.id = rl.source_id
     WHERE rl.extraction_status = 'captured'
       ${sourceFilter}
     ORDER BY rl.last_seen_at DESC
     LIMIT $1`,
    params,
  );

  log.info(`Found ${rawRows.length} raw listings to replay`);

  let processed = 0;
  let unchanged = 0;
  let updated = 0;
  let errors = 0;

  for (const raw of rawRows) {
    try {
      const code = raw.source_code;
      const normalizer = normalizers.get(code);
      if (!normalizer) {
        log.warn(`No normalizer for source "${code}", skipping raw listing ${raw.id}`);
        errors++;
        continue;
      }

      const rawPayload = raw.raw_payload as SourceRawListingBase;
      const context: NormalizationContext = {
        sourceId: Number(raw.source_id),
        sourceListingKey: raw.source_listing_key,
        sourceExternalId: raw.external_id ?? undefined,
        rawListingId: Number(raw.id),
        scrapeRunId: Number(raw.last_scrape_run_id),
        canonicalUrl: raw.canonical_url,
        detailUrl: raw.detail_url,
      };

      // Run normalizer
      const result = normalizer.normalize(rawPayload, context);

      if (!result.success || !result.listing) {
        log.warn(`Normalization failed for raw listing ${raw.id}`, {
          errors: result.errors,
        });
        errors++;
        continue;
      }

      // Compare with existing listing
      const existing = await listings.findBySourceKey(
        Number(raw.source_id),
        raw.source_listing_key,
      );

      if (existing && existing.contentFingerprint === result.listing.contentFingerprint) {
        unchanged++;
        continue;
      }

      // Listing changed or is new
      if (dryRun) {
        const status = existing ? 'CHANGED' : 'NEW';
        log.info(`[DRY RUN] ${status}: ${result.listing.title}`, {
          rawListingId: raw.id,
          sourceCode: code,
          oldFingerprint: existing?.contentFingerprint ?? 'none',
          newFingerprint: result.listing.contentFingerprint,
        });
        updated++;
        continue;
      }

      // Upsert the listing
      const upsertedListing = await listings.upsertListing(result.listing);

      // Append version with reason 'backfill'
      const effectiveArea = result.listing.livingAreaSqm ?? result.listing.usableAreaSqm ?? null;
      const pricePerSqmEur =
        result.listing.listPriceEurCents != null && effectiveArea != null && effectiveArea > 0
          ? Math.round((result.listing.listPriceEurCents / 100 / effectiveArea) * 100) / 100
          : null;

      await listingVersions.appendVersion({
        listingId: upsertedListing.id,
        rawListingId: Number(raw.id),
        versionReason: 'backfill',
        contentFingerprint: result.listing.contentFingerprint,
        listingStatus: result.listing.listingStatus as ListingStatus,
        listPriceEurCents: result.listing.listPriceEurCents ?? null,
        livingAreaSqm: result.listing.livingAreaSqm ?? null,
        pricePerSqmEur,
        normalizedSnapshot: result.listing.normalizedPayload,
      });

      updated++;
      log.info(`Updated listing ${upsertedListing.id} from raw ${raw.id}`, {
        sourceCode: code,
        title: result.listing.title.slice(0, 50),
      });
    } catch (err) {
      errors++;
      log.error(`Failed to replay raw listing ${raw.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    processed++;
  }

  console.log('\n=== Normalization Replay Summary ===');
  console.log(`Total processed:  ${processed}`);
  console.log(`Unchanged:        ${unchanged}`);
  console.log(`Updated:          ${updated}`);
  console.log(`Errors:           ${errors}`);
  console.log(`Dry run:          ${dryRun}`);
  console.log('====================================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
