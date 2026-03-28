/**
 * BullMQ worker: detects and expires stale listings.
 *
 * A listing is "stale" if it's still active but hasn't been observed
 * within the configured threshold (default: 7 days). For each stale listing:
 * 1. Mark as 'expired'
 * 2. Create a listing_version with version_reason 'status_change'
 *
 * Expiry is a silent fallback only. Sources that are not healthy are excluded
 * upstream from the stale query so we do not mass-expire listings during
 * source outages or blocking events.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@immoradar/scraper-core';
import type { StaleCheckJobData } from '@immoradar/scraper-core';
import { listings, listingVersions } from '@immoradar/db';
import { computeContentFingerprint } from '@immoradar/normalization';

const log = createLogger('worker:stale-check');

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_BATCH_SIZE = 100;
const MAX_EXPIRED_PER_RUN = 1000;

export function createStaleCheckWorker(): Worker<StaleCheckJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<StaleCheckJobData>(
    QUEUE_NAMES.STALE_CHECK,
    async (job: Job<StaleCheckJobData>) => {
      const thresholdDays = job.data.thresholdDays ?? DEFAULT_THRESHOLD_DAYS;
      const batchSize = job.data.batchSize ?? DEFAULT_BATCH_SIZE;

      log.info('Stale check started', { thresholdDays, batchSize });

      let totalExpired = 0;

      // Process in batches, capped to prevent unbounded runtime
      let batch = await listings.findStaleActive(thresholdDays, batchSize);

      while (batch.length > 0 && totalExpired < MAX_EXPIRED_PER_RUN) {
        for (const listing of batch) {
          try {
            // 1. Mark as expired
            const expiredFingerprint = computeContentFingerprint({
              title: listing.title,
              description: listing.description ?? null,
              listPriceEurCents: listing.listPriceEurCents ?? null,
              livingAreaSqm: listing.livingAreaSqm ?? null,
              usableAreaSqm: listing.usableAreaSqm ?? null,
              rooms: listing.rooms ?? null,
              propertyType: listing.propertyType,
              propertySubtype: listing.propertySubtype ?? null,
              districtNo: listing.districtNo ?? null,
              postalCode: listing.postalCode ?? null,
              city: listing.city,
              contactName: listing.contactName ?? null,
              contactCompany: listing.contactCompany ?? null,
              contactEmail: listing.contactEmail ?? null,
              contactPhone: listing.contactPhone ?? null,
              hasBalcony: listing.hasBalcony ?? null,
              hasTerrace: listing.hasTerrace ?? null,
              hasGarden: listing.hasGarden ?? null,
              hasElevator: listing.hasElevator ?? null,
              parkingAvailable: listing.parkingAvailable ?? null,
              isFurnished: listing.isFurnished ?? null,
              listingStatus: 'expired',
            });
            const updated = await listings.updateLifecycleStatus({
              id: listing.id,
              currentRawListingId: listing.currentRawListingId,
              latestScrapeRunId: listing.latestScrapeRunId,
              listingStatus: 'expired',
              sourceStatusRaw: 'expired_stale',
              contentFingerprint: expiredFingerprint,
            });
            if (!updated) continue; // Already changed by another process

            totalExpired++;

            // 2. Create version row
            await listingVersions.appendVersion({
              listingId: listing.id,
              rawListingId: listing.currentRawListingId,
              versionReason: 'status_change',
              contentFingerprint: expiredFingerprint,
              listingStatus: 'expired',
              listPriceEurCents: listing.listPriceEurCents,
              livingAreaSqm: listing.livingAreaSqm,
              pricePerSqmEur: listing.pricePerSqmEur,
              normalizedSnapshot: {
                ...listing.normalizedPayload,
                listingStatus: 'expired',
                sourceStatusRaw: 'expired_stale',
              },
            });
          } catch (err) {
            log.error('Failed to expire listing', {
              listingId: listing.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Fetch next batch
        batch = await listings.findStaleActive(thresholdDays, batchSize);
      }

      if (totalExpired >= MAX_EXPIRED_PER_RUN) {
        log.warn('Stale check hit cap, more listings may remain', {
          totalExpired,
          cap: MAX_EXPIRED_PER_RUN,
        });
      }

      log.info('Stale check complete', { totalExpired });
    },
    {
      connection,
      prefix,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Stale check job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
