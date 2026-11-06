/**
 * Shared Redis connection factory for BullMQ.
 *
 * Uses ioredis directly but returns `unknown` to avoid type conflicts
 * between the top-level ioredis and BullMQ's bundled copy.
 * Callers cast via `as ConnectionOptions` from 'bullmq'.
 */

import { loadConfig } from '@immoradar/config';
import IORedis from 'ioredis';

const QUIT_TIMEOUT_MS = 1_000;

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

/**
 * Closes the shared connection. Concurrent and repeated calls close it once.
 */
export async function closeRedisConnection(): Promise<void> {
  const closing = _connection;
  if (!closing) return;

  _connection = null;

  // With maxRetriesPerRequest null, quit() never settles while Redis is unreachable.
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, QUIT_TIMEOUT_MS);
  });
  await Promise.race([closing.quit().catch(() => undefined), timedOut]);
  clearTimeout(timer);

  closing.disconnect();
}

export function getQueuePrefix(): string {
  return loadConfig().redis.prefix;
}
