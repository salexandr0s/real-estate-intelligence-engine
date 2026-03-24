#!/usr/bin/env npx tsx
/**
 * Backfill geocode_source on listings that have coordinates but no provenance.
 *
 * Logic:
 *   - geocode_precision is 'source_exact' or 'source_approx' => geocode_source = 'source'
 *   - Otherwise => geocode_source = 'inferred'
 *
 * Processes in batches of 100 to avoid holding long transactions.
 *
 * Usage:
 *   npx tsx scripts/backfill-geocode-provenance.ts
 *   npx tsx scripts/backfill-geocode-provenance.ts --dry-run
 */

import { createLogger } from '@immoradar/observability';
import { query, listings, closePool } from '@immoradar/db';

const log = createLogger('backfill-geocode-provenance');
const isDryRun = process.argv.includes('--dry-run');

// ── Types ──────────────────────────────────────────────────────────────────

interface MissingSourceRow {
  id: string;
  geocode_precision: string | null;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info('Backfilling geocode_source on listings with coordinates but no source', { isDryRun });

  const BATCH_SIZE = 100;
  let totalProcessed = 0;
  let totalSource = 0;
  let totalInferred = 0;
  let totalErrors = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await query<MissingSourceRow>(
      `SELECT id, geocode_precision
       FROM listings
       WHERE latitude IS NOT NULL
         AND geocode_source IS NULL
       ORDER BY id ASC
       LIMIT $1`,
      [BATCH_SIZE],
    );

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of batch) {
      try {
        const precision = row.geocode_precision;
        const geocodeSource =
          precision === 'source_exact' || precision === 'source_approx' ? 'source' : 'inferred';

        if (!isDryRun) {
          await listings.updateGeocodeSource(Number(row.id), geocodeSource);
        }

        if (geocodeSource === 'source') {
          totalSource++;
        } else {
          totalInferred++;
        }
        totalProcessed++;
      } catch (err) {
        totalErrors++;
        if (totalErrors <= 10) {
          log.error(`Error updating listing ${row.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    log.info(`Progress: ${totalProcessed} processed`, {
      source: totalSource,
      inferred: totalInferred,
      errors: totalErrors,
    });

    // If we got fewer than BATCH_SIZE, we are done
    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  // Summary
  console.log('\n=== Geocode Provenance Backfill Summary ===');
  console.log(`Mode:      ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Source:    ${totalSource}`);
  console.log(`Inferred:  ${totalInferred}`);
  console.log(`Errors:    ${totalErrors}`);
  console.log('============================================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
