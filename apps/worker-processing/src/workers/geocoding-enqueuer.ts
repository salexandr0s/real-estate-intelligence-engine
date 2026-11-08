/**
 * BullMQ worker: finds listings due for geocoding and enqueues one job per listing.
 * Runs hourly via scheduler. The Nominatim client spaces its own requests, so the
 * jobs go in without a delay.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  createQueue,
  getRedisConnection,
  getQueuePrefix,
} from '@immoradar/scraper-core';
import type { GeocodeEnqueueJobData, GeocodingJobData } from '@immoradar/scraper-core';
import { listings } from '@immoradar/db';

const log = createLogger('worker:geocode-enqueue');

export function createGeocodingEnqueuer(): Worker<GeocodeEnqueueJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const geocodingQueue = createQueue<GeocodingJobData>(QUEUE_NAMES.GEOCODING);

  const worker = new Worker<GeocodeEnqueueJobData>(
    QUEUE_NAMES.GEOCODE_ENQUEUE,
    async (job: Job<GeocodeEnqueueJobData>) => {
      const limit = job.data.limit ?? 50;
      log.info('Geocoding enqueue started', { triggeredBy: job.data.triggeredBy, limit });

      const needsGeocoding = await listings.findListingsNeedingGeocoding(limit);

      if (needsGeocoding.length === 0) {
        log.info('No listings need geocoding');
        return;
      }

      // Counting the attempts before enqueueing lets an overlapping run skip these
      // listings. If Redis fails partway, the ones not enqueued lose one attempt and
      // wait out its backoff.
      const counted = new Set(
        await listings.markGeocodeAttempts(needsGeocoding.map((listing) => listing.id)),
      );

      let enqueued = 0;
      for (const listing of needsGeocoding) {
        if (!counted.has(listing.id)) continue;
        await geocodingQueue.add(
          `geocode-${listing.id}`,
          {
            listingId: listing.id,
            address: listing.street
              ? `${listing.street}${listing.houseNumber ? ` ${listing.houseNumber}` : ''}`
              : null,
            postalCode: listing.postalCode ?? null,
            city: listing.city,
            districtNo: listing.districtNo ?? null,
            title: listing.title ?? null,
            description: listing.description ?? null,
            addressDisplay: listing.addressDisplay ?? null,
          },
          {
            // A listing already waiting in the queue isn't added twice. With no TTL,
            // BullMQ releases the id when that job completes or finally fails.
            deduplication: { id: `geocode-${listing.id}` },
          },
        );
        enqueued++;
      }

      log.info('Geocoding jobs enqueued', { enqueued });
    },
    { connection, prefix, concurrency: WORKER_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    log.error('Geocode enqueue job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
