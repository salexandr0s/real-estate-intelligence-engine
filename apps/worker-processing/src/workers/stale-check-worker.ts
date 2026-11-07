/**
 * BullMQ worker: moves discovery sightings into listings.last_seen_at, then
 * expires listings whose own detail pages stopped giving a listing.
 *
 * Silence never expires anything. listings.findExpiryCandidates says what counts
 * as evidence. One pass handles at most 100 listings, and the next scheduled run
 * takes the rest.
 *
 * Each run also prunes scraper failure artifacts older than
 * SCRAPER_ARTIFACT_RETENTION_DAYS.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  getRedisConnection,
  getQueuePrefix,
  pruneFailureArtifacts,
} from '@immoradar/scraper-core';
import type { StaleCheckJobData } from '@immoradar/scraper-core';
import { listings, listingVersions } from '@immoradar/db';
import { computeContentFingerprint } from '@immoradar/normalization';

const log = createLogger('worker:stale-check');

const DEFAULT_THRESHOLD_DAYS = 7;
const EXPIRED_STATUS_RAW = 'expired_revalidation_failed';

/** Failure artifacts are debugging aids, so a failed prune is logged and never fails the job. */
async function pruneArtifacts(artifactsDir: string, retentionDays: number): Promise<void> {
  try {
    const { removedFiles, removedBytes } = await pruneFailureArtifacts(artifactsDir, retentionDays);
    log.info('Pruned failure artifacts', { removedFiles, removedBytes, retentionDays });
  } catch (err) {
    log.error('Failed to prune failure artifacts', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createStaleCheckWorker(): Worker<StaleCheckJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const config = loadConfig();

  const worker = new Worker<StaleCheckJobData>(
    QUEUE_NAMES.STALE_CHECK,
    async (job: Job<StaleCheckJobData>) => {
      // Before the database work, so a database outage doesn't also stop the pruning.
      await pruneArtifacts(config.artifacts.dir, config.scraper.artifactRetentionDays);

      const thresholdDays = job.data.thresholdDays ?? DEFAULT_THRESHOLD_DAYS;

      const reconciled = await listings.reconcileLastSeen();
      const candidates = await listings.findExpiryCandidates(thresholdDays);

      let expired = 0;
      for (const listing of candidates) {
        try {
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

          const updated = await listings.markExpiredStale(
            listing.id,
            expiredFingerprint,
            EXPIRED_STATUS_RAW,
          );
          if (!updated) continue; // Another process changed it first

          expired++;

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
              sourceStatusRaw: EXPIRED_STATUS_RAW,
            },
          });
        } catch (err) {
          log.error('Failed to expire listing', {
            listingId: listing.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      log.info('Stale check complete', { reconciled, candidates: candidates.length, expired });
    },
    {
      connection,
      prefix,
      concurrency: WORKER_CONCURRENCY,
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
