/**
 * Every BullMQ queue comes from here, so job retention and concurrency stay in one place.
 */

import { Queue } from 'bullmq';
import type { ConnectionOptions, DefaultJobOptions } from 'bullmq';
import { getQueuePrefix, getRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue-names.js';

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** One job at a time on every queue. It has no env key, so an old .env can't raise it. */
export const WORKER_CONCURRENCY = 1;

const DEFAULT_RETENTION: DefaultJobOptions = {
  removeOnComplete: { age: 86_400, count: 100 },
  removeOnFail: { age: 604_800, count: 200 },
};

// Ingest jobs carry a whole capture, so a finished one doesn't stay in Redis.
const QUEUE_RETENTION: Partial<Record<QueueName, DefaultJobOptions>> = {
  [QUEUE_NAMES.PROCESSING]: {
    removeOnComplete: true,
    removeOnFail: { age: 259_200, count: 50 },
  },
};

/** Jobs added to this queue, and jobs its schedulers create, inherit the retention options. */
export function createQueue<DataType>(name: QueueName): Queue<DataType> {
  return new Queue<DataType>(name, {
    connection: getRedisConnection() as ConnectionOptions,
    prefix: getQueuePrefix(),
    defaultJobOptions: QUEUE_RETENTION[name] ?? DEFAULT_RETENTION,
  });
}
