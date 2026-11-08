#!/usr/bin/env npx tsx
/**
 * Rescore active listings against current baselines, the same way the rescore worker does.
 * Usage: npx tsx scripts/rescore-listings.ts [--source <code>] [--limit N] [--dry-run]
 */

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import { sources, closePool } from '@immoradar/db';
import { SCORE_VERSION } from '@immoradar/scoring';
import { rescoreListingsInBatches } from '@immoradar/ingestion';
import { buildRescoreDeps } from '../apps/worker-processing/src/pipeline-factory.js';

const log = createLogger('rescore');

interface CliArgs {
  sourceCode: string | null;
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let sourceCode: string | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceCode = args[i + 1]!;
      i++;
    }
    if (args[i] === '--limit' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--limit needs a positive whole number, got "${args[i + 1]}"`);
      }
      limit = parsed;
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { sourceCode, limit, dryRun };
}

async function main(): Promise<void> {
  const { sourceCode, limit, dryRun } = parseArgs();
  loadConfig();

  log.info('Starting rescore', {
    sourceCode: sourceCode ?? undefined,
    limit,
    dryRun,
    scoreVersion: SCORE_VERSION,
  });

  // Resolve source filter
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

  const totals = await rescoreListingsInBatches(buildRescoreDeps(), {
    sourceId,
    ...(limit != null ? { maxListings: limit } : {}),
    dryRun,
    onBatch: (running) => log.info(`Examined ${running.examined} listings so far`, running),
  });

  console.log('\n=== Rescore Summary ===');
  console.log(`Source:         ${sourceCode ?? 'all'}`);
  console.log(`Score version:  ${SCORE_VERSION}`);
  console.log(`Examined:       ${totals.examined}`);
  console.log(`Rescored:       ${totals.rescored}`);
  console.log(`Unchanged:      ${totals.unchanged}`);
  console.log(`Errors:         ${totals.failed}`);
  console.log(`Dry run:        ${dryRun}`);
  console.log('======================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
