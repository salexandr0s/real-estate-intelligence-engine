/**
 * BullMQ worker: processes raw detail captures through the ingestion pipeline.
 * Runs normalization → scoring → alert matching for each listing.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import type { DetailCapture, SourceRawListingBase } from '@immoradar/contracts';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  getRedisConnection,
  getQueuePrefix,
  classifyScraperError,
} from '@immoradar/scraper-core';
import type { ProcessingJobData } from '@immoradar/scraper-core';
import { resolveLifecycleStatus } from '@immoradar/ingestion';
import type { FullIngestionPipeline } from '@immoradar/ingestion';
import { deadLetter, rawSightings } from '@immoradar/db';
import { createPipeline } from '../pipeline-factory.js';

const log = createLogger('worker:ingestion');

type DetailOutcome = rawSightings.DetailOutcomeInput['outcome'];

/**
 * What the detail page said about its sighting: `gone` when it said the listing is gone,
 * `parsed` when it gave a listing, `inconclusive` when it loaded but gave neither. Null for a
 * page that answered with an error status, which says nothing about the listing. Gone comes
 * first, because a status-only update on a page that didn't parse still returns a listing ID.
 */
export function detailOutcome(
  capture: Pick<DetailCapture<SourceRawListingBase>, 'responseStatus' | 'availabilityStatus'>,
  listingId: number,
): DetailOutcome | null {
  const status = capture.responseStatus;
  if (resolveLifecycleStatus(capture.availabilityStatus, status) != null) return 'gone';
  if (listingId > 0) return 'parsed';
  // Jobs queued before captures recorded a status have none, and they came from pages that loaded.
  if (status == null || (status >= 200 && status < 300)) return 'inconclusive';
  return null;
}

async function recordDetailOutcome(
  data: ProcessingJobData,
  sightingKey: string,
  outcome: DetailOutcome,
  fetchedAt: Date,
): Promise<void> {
  try {
    await rawSightings.recordDetailOutcome({
      sourceId: data.sourceId,
      sourceListingKey: sightingKey,
      detailUrl: data.detailUrl,
      outcome,
      fetchedAt,
    });
  } catch (err) {
    // The capture is ingested; a lost outcome only changes when the page is fetched next.
    log.warn('Could not record the detail outcome', {
      sourceCode: data.sourceCode,
      sightingKey,
      outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createIngestionWorker(): Worker<ProcessingJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const pipeline: FullIngestionPipeline = createPipeline();

  const worker = new Worker<ProcessingJobData>(
    QUEUE_NAMES.PROCESSING,
    async (job: Job<ProcessingJobData>) => {
      const { sourceCode, sourceId, scrapeRunId, captureJson, sightingKey } = job.data;

      const detailCapture = JSON.parse(captureJson);

      // Restore Date objects from JSON serialization
      if (detailCapture.extractedAt) {
        detailCapture.extractedAt = new Date(detailCapture.extractedAt);
      }

      const result = await pipeline.ingestDetailCapture(detailCapture, sourceId, scrapeRunId);

      const status = result.normalization.isNew ? 'NEW' : 'UPDATED';
      const score = result.scoring?.overallScore ?? null;

      log.info(`${status}: ${detailCapture.payload?.titleRaw ?? 'Unknown'}`, {
        sourceCode,
        listingId: result.normalization.listingId,
        score,
      });

      // Jobs queued before sightings existed have no sighting to update.
      const outcome = sightingKey
        ? detailOutcome(detailCapture, result.normalization.listingId)
        : null;
      if (sightingKey && outcome) {
        // The fetch time, not the job's, so a retried job records the same outcome again.
        const fetchedAt =
          detailCapture.extractedAt instanceof Date &&
          !Number.isNaN(detailCapture.extractedAt.getTime())
            ? detailCapture.extractedAt
            : new Date();
        await recordDetailOutcome(job.data, sightingKey, outcome, fetchedAt);
      }
    },
    {
      connection,
      prefix,
      concurrency: WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    const isTerminal = job != null && job.attemptsMade >= (job.opts?.attempts ?? 1);
    log.error('Ingestion job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      terminal: isTerminal,
      error: err.message,
    });

    if (isTerminal && job) {
      deadLetter
        .insert({
          queueName: QUEUE_NAMES.PROCESSING,
          jobId: job.id ?? 'unknown',
          jobData: job.data as unknown as Record<string, unknown>,
          errorMessage: err.message,
          errorClass: classifyScraperError(err),
          sourceCode: job.data.sourceCode,
          attempts: job.attemptsMade,
        })
        .catch((dlqErr) => log.error('DLQ insert failed', { error: String(dlqErr) }));
    }
  });

  return worker;
}
