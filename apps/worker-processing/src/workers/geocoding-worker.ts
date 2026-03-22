/**
 * BullMQ worker: geocodes listings that lack coordinates.
 * Uses tiered strategy: Nominatim → district centroid → city centroid.
 * Rate-limited to 1 request/second to respect Nominatim usage policy.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@rei/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@rei/scraper-core';
import type { GeocodingJobData } from '@rei/scraper-core';
import { geocodeListing } from '@rei/geocoding';
import { listings } from '@rei/db';

const log = createLogger('worker:geocoding');

export function createGeocodingWorker(): Worker<GeocodingJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<GeocodingJobData>(
    QUEUE_NAMES.GEOCODING,
    async (job: Job<GeocodingJobData>) => {
      const { listingId, address, postalCode, city, districtNo } = job.data;

      log.info('Geocoding listing', { listingId, address, postalCode, districtNo });

      const listing = await listings.findById(listingId);
      if (!listing) {
        log.warn('Listing not found, skipping', { listingId });
        return;
      }

      const result = await geocodeListing({
        listingId,
        address,
        postalCode,
        city,
        districtNo,
        existingLatitude: listing.latitude != null ? Number(listing.latitude) : null,
        existingLongitude: listing.longitude != null ? Number(listing.longitude) : null,
        existingPrecision: listing.geocodePrecision,
      });

      if (!result) {
        log.warn('Geocoding returned no result', { listingId });
        return;
      }

      if (result.source === 'skip') {
        log.debug('Listing already geocoded', { listingId, precision: result.geocodePrecision });
        return;
      }

      await listings.updateCoordinates(
        listingId,
        result.latitude,
        result.longitude,
        result.geocodePrecision,
      );

      log.info('Listing geocoded', {
        listingId,
        source: result.source,
        precision: result.geocodePrecision,
        lat: result.latitude,
        lon: result.longitude,
      });
    },
    {
      connection,
      prefix,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1100, // ~1 req/sec with slight buffer for Nominatim
      },
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Geocoding job failed', {
      jobId: job?.id,
      listingId: job?.data.listingId,
      error: err.message,
    });
  });

  return worker;
}
