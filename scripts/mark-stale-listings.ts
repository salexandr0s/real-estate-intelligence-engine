#!/usr/bin/env npx tsx
/**
 * Mark listings as inactive if they haven't been seen in 7+ days.
 *
 * Usage:
 *   npx tsx scripts/mark-stale-listings.ts [--dry-run]
 */

import { loadConfig } from '@rei/config';
import { createLogger } from '@rei/observability';
import { query, closePool } from '@rei/db';

const log = createLogger('stale-listings');

async function main(): Promise<void> {
  loadConfig();
  const dryRun = process.argv.includes('--dry-run');

  log.info('Checking for stale listings...', { dryRun });

  const staleListings = await query<{ id: string; title: string; last_seen_at: Date }>(
    `SELECT id, title, last_seen_at FROM listings
     WHERE listing_status = 'active'
       AND last_seen_at < NOW() - INTERVAL '7 days'`,
  );

  if (staleListings.length === 0) {
    log.info('No stale listings found');
    await closePool();
    return;
  }

  log.info(`Found ${staleListings.length} stale listing(s)`);

  if (!dryRun) {
    const result = await query<{ count: string }>(
      `WITH updated AS (
         UPDATE listings
         SET listing_status = 'inactive'
         WHERE listing_status = 'active'
           AND last_seen_at < NOW() - INTERVAL '7 days'
         RETURNING id
       )
       SELECT COUNT(*) AS count FROM updated`,
    );
    log.info(`Marked ${result[0]!.count} listing(s) as inactive`);
  } else {
    for (const listing of staleListings) {
      const daysAgo = Math.round((Date.now() - new Date(listing.last_seen_at).getTime()) / 86400000);
      log.info(`[DRY RUN] Would mark inactive: ${listing.title} (${daysAgo} days stale)`);
    }
  }

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
