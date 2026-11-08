/**
 * BullMQ worker: rebuilds cross-source listing clusters.
 * Runs daily at 03:00 via scheduler.
 */

import { Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { createLogger } from '@immoradar/observability';
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  getRedisConnection,
  getQueuePrefix,
} from '@immoradar/scraper-core';
import type { ClusterJobData } from '@immoradar/scraper-core';
import { clusters } from '@immoradar/db';

const log = createLogger('worker:cluster');

export interface ClusterRebuildSummary {
  clusters: number;
  listingsClustered: number;
  staleClustersRemoved: number;
}

/**
 * Upserts one cluster per fingerprint that active listings share across two or more
 * sources, then deletes the clusters whose fingerprint no longer forms such a group.
 */
export async function rebuildClusters(): Promise<ClusterRebuildSummary> {
  const groups = await clusters.findCrossSourceGroups();

  let listingsClustered = 0;
  for (const group of groups) {
    await clusters.upsertCluster(group.fingerprint, group.members);
    listingsClustered += group.members.length;
  }

  // A failed upsert throws before this point, so a job that stops partway leaves
  // the existing clusters alone.
  const staleClustersRemoved = await clusters.deleteExcept(
    groups.map((group) => group.fingerprint),
  );

  return { clusters: groups.length, listingsClustered, staleClustersRemoved };
}

export function createClusterWorker(): Worker<ClusterJobData> {
  const connection = getRedisConnection() as ConnectionOptions;
  const prefix = getQueuePrefix();

  const worker = new Worker<ClusterJobData>(
    QUEUE_NAMES.CLUSTER,
    async (job: Job<ClusterJobData>) => {
      log.info('Cluster rebuild started', { triggeredBy: job.data.triggeredBy });
      const summary = await rebuildClusters();
      log.info('Cluster rebuild complete', { ...summary });
    },
    { connection, prefix, concurrency: WORKER_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    log.error('Cluster job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}
