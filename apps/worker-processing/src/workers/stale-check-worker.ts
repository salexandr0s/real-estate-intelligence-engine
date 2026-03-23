/**
 * BullMQ worker: detects and expires stale listings.
 *
 * A listing is "stale" if it's still active but hasn't been observed
 * within the configured threshold (default: 7 days). For each stale listing:
 * 1. Mark as 'expired'
 * 2. Create a listing_version with version_reason 'status_change'
 * 3. Run filter matching to generate status_change alerts
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@rei/observability';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@rei/scraper-core';
import type { StaleCheckJobData, AlertDeliveryJobData } from '@rei/scraper-core';
import { listings, listingVersions, userFilters, alerts } from '@rei/db';
import type { AlertChannel } from '@rei/contracts';
import { buildAlertDedupeKey } from '@rei/contracts';

const log = createLogger('worker:stale-check');

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_BATCH_SIZE = 100;
const MAX_EXPIRED_PER_RUN = 1000;

export function createStaleCheckWorker(): Worker<StaleCheckJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const deliveryQueue = new Queue<AlertDeliveryJobData>(QUEUE_NAMES.ALERT_DELIVERY, {
    connection,
    prefix,
  });

  const worker = new Worker<StaleCheckJobData>(
    QUEUE_NAMES.STALE_CHECK,
    async (job: Job<StaleCheckJobData>) => {
      const thresholdDays = job.data.thresholdDays ?? DEFAULT_THRESHOLD_DAYS;
      const batchSize = job.data.batchSize ?? DEFAULT_BATCH_SIZE;

      log.info('Stale check started', { thresholdDays, batchSize });

      let totalExpired = 0;
      let totalAlerts = 0;

      // Process in batches, capped to prevent unbounded runtime
      let batch = await listings.findStaleActive(thresholdDays, batchSize);

      while (batch.length > 0 && totalExpired < MAX_EXPIRED_PER_RUN) {
        for (const listing of batch) {
          try {
            // 1. Mark as expired
            const updated = await listings.markExpired(listing.id);
            if (!updated) continue; // Already changed by another process

            totalExpired++;

            // 2. Create version row
            await listingVersions.appendVersion({
              listingId: listing.id,
              rawListingId: listing.currentRawListingId,
              versionReason: 'status_change',
              contentFingerprint: listing.contentFingerprint ?? '',
              listingStatus: 'expired',
              listPriceEurCents: listing.listPriceEurCents,
              livingAreaSqm: listing.livingAreaSqm,
              pricePerSqmEur: listing.pricePerSqmEur,
              normalizedSnapshot: {},
            });

            // 3. Find matching filters and create status_change alerts
            const matchResult = await userFilters.findMatchingFilters({
              operationType: listing.operationType,
              propertyType: listing.propertyType,
              districtNo: listing.districtNo,
              listPriceEurCents: listing.listPriceEurCents,
              livingAreaSqm: listing.livingAreaSqm,
              rooms: listing.rooms,
              currentScore: listing.currentScore,
              title: listing.title,
              description: listing.description,
            });

            for (const match of matchResult.matched) {
              const channels: string[] =
                match.alertChannels.length > 0 ? match.alertChannels : ['in_app'];
              const dedupeKey = buildAlertDedupeKey({
                filterId: match.id,
                listingId: listing.id,
                alertType: 'status_change',
              });

              for (const channel of channels) {
                const alertResult = await alerts.create({
                  userId: match.userId,
                  userFilterId: match.id,
                  listingId: listing.id,
                  listingVersionId: null,
                  alertType: 'status_change',
                  channel: channel as AlertChannel,
                  dedupeKey,
                  title: `Nicht mehr verfügbar: ${listing.title}`,
                  body: `Dieses Inserat ist seit ${thresholdDays}+ Tagen nicht mehr sichtbar.`,
                });

                if (alertResult) {
                  totalAlerts++;
                  if (channel !== 'in_app') {
                    await deliveryQueue.add(
                      `deliver:${alertResult.id}`,
                      { alertId: alertResult.id, channel, userId: match.userId },
                      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
                    );
                  }
                }
              }
            }
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

      log.info('Stale check complete', { totalExpired, totalAlerts });
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
