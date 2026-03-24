/**
 * Shared Redis connection factory for BullMQ.
 *
 * Uses ioredis directly but returns `unknown` to avoid type conflicts
 * between the top-level ioredis and BullMQ's bundled copy.
 * Callers cast via `as ConnectionOptions` from 'bullmq'.
 */

import { loadConfig } from '@immoradar/config';
import IORedis from 'ioredis';

let _connection: IORedis | null = null;

/**
 * Returns a shared IORedis connection configured for BullMQ.
 * Cast the result to `ConnectionOptions` at the call site.
 */
export function getRedisConnection(): unknown {
  if (_connection) return _connection;

  const config = loadConfig();
  _connection = new IORedis(config.redis.url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });

  return _connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}

export function getQueuePrefix(): string {
  return loadConfig().redis.prefix;
}
