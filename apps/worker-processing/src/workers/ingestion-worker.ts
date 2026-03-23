/**
 * BullMQ worker: processes raw detail captures through the ingestion pipeline.
 * Runs normalization → scoring → alert matching for each listing.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@rei/observability';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getQueuePrefix,
  classifyScraperError,
} from '@rei/scraper-core';
import type { ProcessingJobData } from '@rei/scraper-core';
import type { FullIngestionPipeline } from '@rei/ingestion';
import { deadLetter } from '@rei/db';
import { createPipeline } from '../pipeline-factory.js';

const log = createLogger('worker:ingestion');

export function createIngestionWorker(): Worker<ProcessingJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const pipeline: FullIngestionPipeline = createPipeline();

  const worker = new Worker<ProcessingJobData>(
    QUEUE_NAMES.PROCESSING,
    async (job: Job<ProcessingJobData>) => {
      const { sourceCode, sourceId, scrapeRunId, captureJson } = job.data;

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
    },
    {
      connection,
      prefix,
      concurrency: 2,
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
