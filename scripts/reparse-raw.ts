#!/usr/bin/env npx tsx
/**
 * Re-verify and reparse raw listing snapshots.
 *
 * For each raw_listing, recomputes the content hash from the stored raw_payload
 * and compares it to the stored content_sha256. This detects silent corruption
 * or payload drift. It also re-runs the source normalizer to verify that stored
 * payloads still produce valid normalization output.
 *
 * Usage:
 *   npx tsx scripts/reparse-raw.ts [--source <code>] [--limit N] [--dry-run]
 */

import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';
import { query, sources, closePool, execute } from '@rei/db';
import { computeContentHash } from '@rei/scraper-core';
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
import type { SourceRawListingBase, NormalizationContext } from '@rei/contracts';

const log = createLogger('reparse-raw');

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

// ── DB row type ─────────────────────────────────────────────────────────────

interface RawListingReparseRow {
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

  log.info('Starting raw snapshot reparse', { sourceCode, limit, dryRun });

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

  // Query raw listings
  const sourceFilter = sourceId != null ? 'AND rl.source_id = $2' : '';
  const params: unknown[] = [limit];
  if (sourceId != null) params.push(sourceId);

  const rawRows = await query<RawListingReparseRow>(
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

  log.info(`Found ${rawRows.length} raw listings to reparse`);

  let total = 0;
  let hashMatched = 0;
  let hashChanged = 0;
  let normalizationOk = 0;
  let normalizationFailed = 0;
  let updated = 0;
  let errors = 0;

  for (const raw of rawRows) {
    total++;

    try {
      const code = raw.source_code;
      const payload = raw.raw_payload;

      // Step 1: Recompute content hash
      const recomputedHash = computeContentHash(payload);
      const hashDiffers = recomputedHash !== raw.content_sha256;

      if (hashDiffers) {
        hashChanged++;
        log.warn(`Hash mismatch for raw listing ${raw.id}`, {
          storedHash: raw.content_sha256.slice(0, 12),
          recomputedHash: recomputedHash.slice(0, 12),
          sourceCode: code,
        });

        if (!dryRun) {
          await execute(`UPDATE raw_listings SET content_sha256 = $1 WHERE id = $2`, [
            recomputedHash,
            raw.id,
          ]);
          updated++;
        }
      } else {
        hashMatched++;
      }

      // Step 2: Verify normalization still succeeds
      const normalizer = normalizers.get(code);
      if (!normalizer) {
        log.warn(`No normalizer for source "${code}", skipping normalization check for ${raw.id}`);
        continue;
      }

      const rawPayload = payload as SourceRawListingBase;
      const context: NormalizationContext = {
        sourceId: Number(raw.source_id),
        sourceListingKey: raw.source_listing_key,
        sourceExternalId: raw.external_id ?? undefined,
        rawListingId: Number(raw.id),
        scrapeRunId: Number(raw.last_scrape_run_id),
        canonicalUrl: raw.canonical_url,
        detailUrl: raw.detail_url,
      };

      const result = normalizer.normalize(rawPayload, context);

      if (result.success) {
        normalizationOk++;
      } else {
        normalizationFailed++;
        log.warn(`Normalization fails for raw listing ${raw.id}`, {
          errors: result.errors,
          sourceCode: code,
        });
      }
    } catch (err) {
      errors++;
      log.error(`Failed to reparse raw listing ${raw.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log('\n=== Raw Reparse Summary ===');
  console.log(`Total:                 ${total}`);
  console.log(`Hash matched:          ${hashMatched}`);
  console.log(`Hash changed:          ${hashChanged}`);
  console.log(`Updated (hash fix):    ${updated}`);
  console.log(`Normalization OK:      ${normalizationOk}`);
  console.log(`Normalization failed:  ${normalizationFailed}`);
  console.log(`Errors:                ${errors}`);
  console.log(`Dry run:               ${dryRun}`);
  console.log('===========================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
