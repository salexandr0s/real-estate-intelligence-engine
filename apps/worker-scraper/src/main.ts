import { loadConfig } from '@immoradar/config';
import { createLogger, runMain, setLogLevel, redactUrl } from '@immoradar/observability';
import type { LogLevel } from '@immoradar/observability';
import { closeRedisConnection } from '@immoradar/scraper-core';
import { closePool } from '@immoradar/db';
import { createDiscoveryWorker } from './workers/discovery-worker.js';
import { createDetailWorker } from './workers/detail-worker.js';
import { closeBrowser, getBrowser } from './browser-pool.js';
import { startScheduler } from './scheduler.js';

const logger = createLogger('worker-scraper');

// The engine watchdog sends SIGKILL at 10 s.
const HARD_TIMEOUT_MS = 8_000;
// Worker.close() waits for running jobs with no limit, so shutdown moves on after this long.
const WORKER_CLOSE_GRACE_MS = 5_000;
const BROWSER_CLOSE_GRACE_MS = 2_000;

runMain('worker-scraper', HARD_TIMEOUT_MS, async (lifecycle) => {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info('Scraper worker starting', {
    nodeEnv: config.nodeEnv,
    redisUrl: redactUrl(config.redis.url),
    runtimeBootMode: config.runtime.bootMode,
  } as Record<string, unknown>);

  const discoveryWorker = createDiscoveryWorker(lifecycle.shutdownSignal);
  const detailWorker = createDetailWorker();

  lifecycle.onShutdown(
    'workers',
    async () => {
      await Promise.all([discoveryWorker.close(), detailWorker.close()]);
    },
    WORKER_CLOSE_GRACE_MS,
  );
  lifecycle.onShutdown('browser', closeBrowser, BROWSER_CLOSE_GRACE_MS);
  lifecycle.onShutdown('redis', closeRedisConnection);
  lifecycle.onShutdown('database pool', closePool);

  logger.info('Discovery and detail workers ready');

  // The smoke test checks that Chromium stops with the scraper, and it runs no crawl to start one.
  if (process.env['IMMORADAR_SMOKE_LAUNCH_BROWSER'] === '1') {
    await getBrowser();
  }

  await startScheduler();
});
