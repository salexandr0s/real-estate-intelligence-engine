#!/usr/bin/env npx tsx
/**
 * Cross-source cluster build script.
 *
 * Groups active listings by cross_source_fingerprint, creates
 * listing_clusters + listing_cluster_members records for listings
 * that appear on 2+ sources, and deletes clusters whose fingerprint
 * no longer appears on 2+ sources. Runs the same rebuild as the
 * cluster worker.
 *
 * Usage:
 *   npx tsx scripts/build-clusters.ts
 *   npx tsx scripts/build-clusters.ts --dry-run
 */

import { createLogger } from '@immoradar/observability';
import { clusters, closePool } from '@immoradar/db';
import { rebuildClusters } from '../apps/worker-processing/src/workers/cluster-worker.js';

const log = createLogger('clusters-cli');
const isDryRun = process.argv.includes('--dry-run');

async function buildClusters(): Promise<void> {
  log.info('Building cross-source clusters...', { isDryRun });

  if (isDryRun) {
    const groups = await clusters.findCrossSourceGroups();
    log.info(`Found ${groups.length} fingerprints with 2+ sources`);
    for (const group of groups.slice(0, 10)) {
      const ids = group.members.map((member) => member.listingId);
      log.info(`  [dry-run] ${group.fingerprint.slice(0, 12)}... → ${ids.length} listings`, {
        listingIds: ids,
      });
    }
    log.info(`Dry run complete. Would create ${groups.length} clusters.`);
    return;
  }

  const summary = await rebuildClusters();
  // run-pipeline.ts reads the cluster count from this line's "<n> clusters".
  log.info(
    `Built ${summary.clusters} clusters and removed ${summary.staleClustersRemoved} stale ones`,
    { ...summary },
  );
}

buildClusters()
  .catch((err: unknown) => {
    log.error('Cluster build failed', { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
