#!/usr/bin/env npx tsx
/**
 * Recomputes today's market baselines from the active listings, the same way the baseline
 * worker does: one row per district and city-wide, per area and room bucket, plus one
 * all-bucket row for each.
 *
 * Usage:
 *   npx tsx scripts/compute-baselines.ts
 */

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import { closePool } from '@immoradar/db';
import { recomputeBaselines } from '../apps/worker-processing/src/workers/baseline-worker.js';

const log = createLogger('baselines-cli');

async function main(): Promise<void> {
  loadConfig();
  log.info('Computing market baselines...');

  const summary = await recomputeBaselines();
  if (summary.listings === 0) {
    log.warn('No active listings with price data. Run scrape-and-ingest first.');
  }

  // run-pipeline.ts reads the count from the "Baselines upserted" line.
  console.log('\n=== Baseline Summary ===');
  console.log(`Active listings:     ${summary.listings}`);
  console.log(`Groups:              ${summary.groups}`);
  console.log(`Baselines upserted:  ${summary.upserted}`);
  console.log(`Skipped (< 3 items): ${summary.skippedSmall}`);
  console.log('========================\n');
}

main()
  .catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
