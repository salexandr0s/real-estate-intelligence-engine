/**
 * BullMQ worker: finds listings needing geocoding and enqueues individual geocoding jobs.
 * Runs every 30 minutes via scheduler.
 */

import { Worker, Queue } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@immoradar/scraper-core';
import type { GeocodeEnqueueJobData, GeocodingJobData } from '@immoradar/scraper-core';
import { listings } from '@immoradar/db';

const log = createLogger('worker:geocode-enqueue');

export function createGeocodingEnqueuer(): Worker<GeocodeEnqueueJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const geocodingQueue = new Queue<GeocodingJobData>(QUEUE_NAMES.GEOCODING, {
    connection,
    prefix,
  });

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

      let enqueued = 0;
      for (const listing of needsGeocoding) {
        await geocodingQueue.add(
          `geocode:${listing.id}`,
          {
            listingId: listing.id,
            address: listing.street ?? null,
            postalCode: listing.postalCode ?? null,
            city: listing.city,
            districtNo: listing.districtNo ?? null,
            title: listing.title ?? null,
            description: listing.description ?? null,
            addressDisplay: listing.addressDisplay ?? null,
          },
          {
            // Stagger jobs by 1.5s to respect Nominatim rate limits
            delay: enqueued * 1500,
          },
        );
        enqueued++;
      }

      log.info('Geocoding jobs enqueued', { enqueued });
    },
    { connection, prefix, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error('Geocode enqueue job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
