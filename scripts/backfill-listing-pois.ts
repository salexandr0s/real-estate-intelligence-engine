/**
 * Backfill listing_pois cache for all geocoded active listings.
 * Computes Haversine distances and caches the 2 nearest POIs per category.
 *
 * Usage: npx tsx scripts/backfill-listing-pois.ts
 */

import { query } from '@rei/db';
import { listingPois } from '@rei/db';

interface ListingCoord {
  id: string;
  latitude: string;
  longitude: string;
}

async function main() {
  const rows = await query<ListingCoord>(
    `SELECT id, latitude, longitude FROM listings
     WHERE listing_status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL`,
  );
  console.log(`Found ${rows.length} geocoded active listings`);

  let done = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await listingPois.computeAndCache(
        Number(row.id),
        Number(row.latitude),
        Number(row.longitude),
      );
      done++;
      if (done % 20 === 0) {
        console.log(`  ${done}/${rows.length} computed...`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  Error for listing ${row.id}:`, (err as Error).message);
      }
    }
  }

  console.log(`\nDone: ${done} listings cached, ${errors} errors`);
  process.exit(0);
}

main();
