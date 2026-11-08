/**
 * BullMQ worker: rescores active listings against the current market baselines when the app or
 * POST /v1/admin/rescore asks for it. It pages through the listings in id order until it reaches
 * the job's limit or the last active listing.
 */

import { UnrecoverableError, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  getRedisConnection,
  getQueuePrefix,
} from '@immoradar/scraper-core';
import type { RescoreJobData } from '@immoradar/scraper-core';
import { sources } from '@immoradar/db';
import { RESCORE_BATCH_SIZE, rescoreListingsInBatches } from '@immoradar/ingestion';
import { buildRescoreDeps } from '../pipeline-factory.js';

const log = createLogger('worker:rescore');

/** The job data comes from Redis, so a job without a usable limit gets the API's default. */
function jobLimit(limit: unknown): number {
  return typeof limit === 'number' && Number.isInteger(limit) && limit > 0
    ? limit
    : RESCORE_BATCH_SIZE;
}

async function resolveSourceId(sourceCode: string | null): Promise<number | null> {
  if (!sourceCode) return null;
  const source = await sources.findByCode(sourceCode);
  // A retry can't make an unknown source code known.
  if (!source) throw new UnrecoverableError(`Unknown source code: ${sourceCode}`);
  return source.id;
}

export function createRescoreWorker(): Worker<RescoreJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();
  const deps = buildRescoreDeps();

  const worker = new Worker<RescoreJobData>(
    QUEUE_NAMES.RESCORE,
    async (job: Job<RescoreJobData>) => {
      const { triggeredBy, sourceCode } = job.data;
      const limit = jobLimit(job.data.limit);
      const sourceId = await resolveSourceId(sourceCode);
      const logContext = { triggeredBy, sourceCode: sourceCode ?? undefined };
      log.info('Rescore started', { ...logContext, limit });

      const totals = await rescoreListingsInBatches(deps, { sourceId, maxListings: limit });
      const summary = { ...logContext, ...totals };
      if (totals.failed > 0) {
        log.warn('Rescore complete with failures', summary);
      } else {
        log.info('Rescore complete', summary);
      }
    },
    {
      connection,
      prefix,
      concurrency: WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    log.error('Rescore job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
