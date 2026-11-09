import type { FastifyInstance } from 'fastify';
import IORedis from 'ioredis';
import { loadConfig } from '@immoradar/config';
import {
  query,
  sources,
  scrapeRuns,
  marketBaselines,
  deadLetter,
  canaryResults,
} from '@immoradar/db';
import { createLogger } from '@immoradar/observability';
import { discoveryIntervalHours } from '@immoradar/scraper-core';

const APP_VERSION = process.env['npm_package_version'] ?? '0.1.0';
const logger = createLogger('api:health');

/** Each dependency check gets this long, so /health answers within the app's 2 s probe. */
const CHECK_TIMEOUT_MS = 1_000;
/** Baselines are computed daily, and scoring treats ones older than two days as stale. */
const BASELINE_STALE_HOURS = 48;

type CheckResult = 'ok' | 'error';

interface CheckOutcome {
  result: CheckResult;
  reason?: string;
}

/** Runs `check` once at a time: callers that arrive while it is pending share that run. */
function singleFlight(check: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= check().finally(() => {
      pending = null;
    });
    return pending;
  };
}

async function settleWithin(check: Promise<void>, timeoutMs: number): Promise<CheckOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<CheckOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ result: 'error', reason: `no answer within ${timeoutMs} ms` }),
      timeoutMs,
    );
  });
  const settled = check.then(
    (): CheckOutcome => ({ result: 'ok' }),
    (err: unknown): CheckOutcome => ({
      result: 'error',
      reason: err instanceof Error ? err.message : String(err),
    }),
  );
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A bounded check that never queues behind itself, so a hung dependency can't collect probes.
 * It logs only when the result changes, not on every poll.
 */
function dependencyCheck(name: string, run: () => Promise<void>): () => Promise<CheckResult> {
  const runOnce = singleFlight(run);
  let last: CheckResult = 'ok';
  return async () => {
    const outcome = await settleWithin(runOnce(), CHECK_TIMEOUT_MS);
    if (outcome.result !== last) {
      if (outcome.result === 'error') {
        logger.warn(`Health check failed: ${name} is unreachable`, { reason: outcome.reason });
      } else {
        logger.info(`Health check: ${name} answers again`);
      }
      last = outcome.result;
    }
    return outcome.result;
  };
}

interface RedisProbe {
  ping(): Promise<void>;
  close(): void;
}

/**
 * A client of its own: the queues' shared connection holds commands while Redis is down and
 * retries forever, so PINGs sent through it would pile up. This one sends nothing while
 * disconnected and reconnects only when a check asks.
 */
function createRedisProbe(url: string): RedisProbe {
  const client = new IORedis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    connectTimeout: CHECK_TIMEOUT_MS,
    commandTimeout: CHECK_TIMEOUT_MS,
  });
  // The check reports failures. Without a listener, ioredis prints each one to stderr.
  client.on('error', () => undefined);

  return {
    async ping() {
      try {
        if (client.status === 'wait' || client.status === 'end') await client.connect();
        await client.ping();
      } catch (err) {
        // Drop a half-open connection, so the next check starts clean instead of waiting behind it.
        client.disconnect();
        throw err;
      }
    },
    close() {
      client.disconnect();
    },
  };
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  let redisProbe: RedisProbe | null = null;

  const checkPostgres = dependencyCheck('postgres', async () => {
    await query('SELECT 1');
  });
  const checkRedis = dependencyCheck('redis', () => {
    redisProbe ??= createRedisProbe(config.redis.url);
    return redisProbe.ping();
  });

  app.addHook('onClose', async () => {
    redisProbe?.close();
    redisProbe = null;
  });

  // Always 200 while the process runs: the app restarts the API after failed probes, and a restart
  // can't bring Postgres or Redis back. The body names the dependency that is down.
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
    return reply.send({
      status: postgres === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      checks: { postgres, redis },
    });
  });

  app.get(
    '/v1/health/pipeline',
    {
      schema: {
        tags: ['Health'],
        summary: 'Pipeline health status',
        description:
          'Returns operational health of the scanning pipeline: source statuses, baseline freshness, DLQ size, and canary results.',
      },
    },
    async (_request, reply) => {
      const [activeSources, latestBaselineDate, dlqCount, canaryLatest] = await Promise.all([
        sources.findActive(),
        marketBaselines.findLatestBaselineDate(),
        deadLetter.countRecent(24),
        canaryResults.findLatestPerSource(),
      ]);

      const now = Date.now();

      // A source is stale after missing about two scheduled discovery runs.
      const floorMinutes = config.scraper.minCrawlIntervalMinutes;

      // Per-source health with last scrape info
      const sourceStatuses = await Promise.all(
        activeSources.map(async (source) => {
          const recentRuns = await scrapeRuns.findRecent(source.id, 1);
          const lastRun = recentRuns[0] ?? null;
          const lastRunAgeHours = lastRun?.finishedAt
            ? (now - lastRun.finishedAt.getTime()) / 3_600_000
            : null;
          const staleAfterHours =
            2 * discoveryIntervalHours(source.crawlIntervalMinutes, floorMinutes);

          const canary = canaryLatest.find((c) => c.sourceCode === source.code);

          return {
            code: source.code,
            healthStatus: source.healthStatus,
            lastRunStatus: lastRun?.status ?? null,
            lastRunAgeHours: lastRunAgeHours != null ? Math.round(lastRunAgeHours * 10) / 10 : null,
            lastRunListingsDiscovered: lastRun?.listingsDiscovered ?? null,
            stale: lastRunAgeHours != null && lastRunAgeHours > staleAfterHours,
            canary: canary
              ? {
                  success: canary.success,
                  agoHours: Math.round(((now - canary.createdAt.getTime()) / 3_600_000) * 10) / 10,
                }
              : null,
          };
        }),
      );

      // Baseline freshness
      const baselineAgeHours = latestBaselineDate
        ? (now - latestBaselineDate.getTime()) / 3_600_000
        : null;
      const baselinesStale = baselineAgeHours != null && baselineAgeHours > BASELINE_STALE_HOURS;

      const healthySources = sourceStatuses.filter((s) => s.healthStatus === 'healthy').length;
      const staleSources = sourceStatuses.filter((s) => s.stale).length;

      const overallStatus =
        healthySources === 0
          ? 'critical'
          : staleSources > activeSources.length / 2 || baselinesStale
            ? 'degraded'
            : dlqCount > 50
              ? 'warning'
              : 'healthy';

      return reply.send({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        sources: sourceStatuses,
        baselines: {
          latestDate: latestBaselineDate?.toISOString() ?? null,
          ageHours: baselineAgeHours != null ? Math.round(baselineAgeHours * 10) / 10 : null,
          stale: baselinesStale,
        },
        deadLetterQueue: {
          last24h: dlqCount,
        },
        summary: {
          totalSources: activeSources.length,
          healthySources,
          staleSources,
        },
      });
    },
  );
}
