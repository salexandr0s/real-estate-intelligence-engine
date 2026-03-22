#!/usr/bin/env npx tsx
/**
 * Geocode listings that are missing coordinates.
 *
 * Usage:
 *   npx tsx scripts/geocode-missing.ts
 *   npx tsx scripts/geocode-missing.ts --dry-run
 *   npx tsx scripts/geocode-missing.ts --limit 10
 */

import { createLogger } from '@rei/observability';
import { listings, closePool } from '@rei/db';
import { geocodeListing } from '@rei/geocoding';

const log = createLogger('geocode-cli');
const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1] ?? '100', 10) : 100;

async function main(): Promise<void> {
  log.info('Finding listings needing geocoding...', { isDryRun, limit });

  const needGeocoding = await listings.findListingsNeedingGeocoding(limit);
  log.info(`Found ${needGeocoding.length} listings without coordinates`);

  if (needGeocoding.length === 0) {
    log.info('All listings have coordinates!');
    return;
  }

  let geocoded = 0;
  let failed = 0;
  let skipped = 0;

  for (const listing of needGeocoding) {
    try {
      const result = await geocodeListing({
        listingId: listing.id,
        address: listing.street
          ? `${listing.street}${listing.houseNumber ? ` ${listing.houseNumber}` : ''}`
          : null,
        postalCode: listing.postalCode,
        city: listing.city,
        districtNo: listing.districtNo,
        existingLatitude: listing.latitude,
        existingLongitude: listing.longitude,
        existingPrecision: listing.geocodePrecision,
        title: listing.title,
        description: listing.description,
        addressDisplay: listing.addressDisplay,
      });

      if (!result || result.source === 'skip') {
        skipped++;
        continue;
      }

      log.info(`Geocoded: ${listing.title.slice(0, 60)}...`, {
        listingId: listing.id,
        precision: result.geocodePrecision,
        source: result.source,
        lat: result.latitude.toFixed(5),
        lon: result.longitude.toFixed(5),
      });

      if (!isDryRun) {
        await listings.updateCoordinates(
          listing.id,
          result.latitude,
          result.longitude,
          result.geocodePrecision,
        );
      }
      geocoded++;

      // Rate limit: 1 request per second for Nominatim
      await new Promise((r) => setTimeout(r, 1100));
    } catch (err) {
      log.error(`Failed to geocode listing ${listing.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  console.log('\n=== Geocoding Summary ===');
  console.log(`Total:    ${needGeocoding.length}`);
  console.log(`Geocoded: ${geocoded}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Failed:   ${failed}`);
  console.log('=========================\n');
}

main()
  .catch((err: unknown) => {
    log.error('Geocoding failed', { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
