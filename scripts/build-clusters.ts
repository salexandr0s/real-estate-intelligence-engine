#!/usr/bin/env npx tsx
/**
 * Cross-source cluster build script.
 *
 * Groups active listings by cross_source_fingerprint and creates
 * listing_clusters + listing_cluster_members records for listings
 * that appear on 2+ sources.
 *
 * Usage:
 *   npx tsx scripts/build-clusters.ts
 *   npx tsx scripts/build-clusters.ts --dry-run
 */

import { createLogger } from '@rei/observability';
import { query, clusters, closePool } from '@rei/db';

const log = createLogger('clusters-cli');
const isDryRun = process.argv.includes('--dry-run');

interface ClusterGroupRow {
  fingerprint: string;
  listing_ids: string[];
  source_ids: string[];
  prices: (string | null)[];
  scores: (string | null)[];
}

async function buildClusters(): Promise<void> {
  log.info('Building cross-source clusters...', { isDryRun });

  const groups = await query<ClusterGroupRow>(
    `SELECT
       cross_source_fingerprint AS fingerprint,
       array_agg(id::text ORDER BY current_score DESC NULLS LAST) AS listing_ids,
       array_agg(source_id::text ORDER BY current_score DESC NULLS LAST) AS source_ids,
       array_agg(list_price_eur_cents::text ORDER BY current_score DESC NULLS LAST) AS prices,
       array_agg(current_score::text ORDER BY current_score DESC NULLS LAST) AS scores
     FROM listings
     WHERE cross_source_fingerprint IS NOT NULL
       AND listing_status = 'active'
     GROUP BY cross_source_fingerprint
     HAVING COUNT(DISTINCT source_id) >= 2`,
    [],
  );

  log.info(`Found ${groups.length} fingerprints with 2+ sources`);

  if (isDryRun) {
    for (const group of groups.slice(0, 10)) {
      const ids = group.listing_ids.map(Number);
      log.info(`  [dry-run] ${group.fingerprint.slice(0, 12)}... → ${ids.length} listings`, {
        listingIds: ids,
      });
    }
    log.info(`Dry run complete. Would create ${groups.length} clusters.`);
    return;
  }

  let created = 0;
  let totalMembers = 0;

  for (const group of groups) {
    const members = group.listing_ids.map((idStr, i) => ({
      listingId: Number(idStr),
      sourceId: Number(group.source_ids[i]),
      listPriceEurCents: group.prices[i] != null ? Number(group.prices[i]) : null,
    }));

    await clusters.upsertCluster(group.fingerprint, members);
    created++;
    totalMembers += members.length;
  }

  log.info('Cluster build complete', {
    clustersCreated: created,
    totalListingsClustered: totalMembers,
  });
}

buildClusters()
  .catch((err: unknown) => {
    log.error('Cluster build failed', { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
