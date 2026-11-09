import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { loadConfig } from '@immoradar/config';
import type { ScraperRunMetrics, SourceRow } from '@immoradar/contracts';
import {
  ConflictError,
  NotFoundError,
  TransientError,
  createLogger,
} from '@immoradar/observability';
import { sources, scrapeRuns, canaryResults } from '@immoradar/db';
import {
  QUEUE_NAMES,
  createQueue,
  maxPagesForSource,
  syncDiscoverySchedule,
} from '@immoradar/scraper-core';
import type { DiscoveryJobData, QueueName } from '@immoradar/scraper-core';
import {
  parseOrThrow,
  idParamSchema,
  paginationQuerySchema,
  scrapeRunCreateSchema,
  sourceUpdateSchema,
  canaryHistoryQuerySchema,
} from '../schemas.js';

// Lazily-initialized shared queue for discovery jobs (avoids one Redis connection per request)
let discoveryQueue: Queue<DiscoveryJobData> | null = null;
const logger = createLogger('api:sources');
const SCRAPE_QUEUE_READY_TIMEOUT_MS = 5_000;
const SCRAPE_QUEUE_UNAVAILABLE_MESSAGE =
  'Scrape queue is unavailable. Check Redis and the scraper worker, then try again.';
const EMPTY_SCRAPE_RUN_METRICS: ScraperRunMetrics = {
  pagesFetched: 0,
  listingsDiscovered: 0,
  http2xx: 0,
  http4xx: 0,
  http5xx: 0,
  captchaCount: 0,
  retryCount: 0,
};

function getDiscoveryQueue(): Queue<DiscoveryJobData> {
  if (!discoveryQueue) {
    discoveryQueue = createQueue<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY);
  }
  return discoveryQueue;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(onTimeout()), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function syncAllDiscoverySchedules(): Promise<void> {
  const queue = getDiscoveryQueue();
  const config = loadConfig();
  const allSources = await sources.findAll();
  await Promise.all(allSources.map((source) => syncDiscoverySchedule(queue, source, config)));
}

/** Why the scraper would refuse to run this source, or null when it may run. */
function runRefusal(source: SourceRow): string | null {
  const reason = sources.disabledReasonOf(source);
  const detail = reason ? ` (${reason})` : '';
  if (source.legalStatus === 'disabled') {
    return `Source ${source.code} is legally disabled, so it can't run.`;
  }
  if (source.healthStatus === 'disabled') {
    return `Source ${source.code} was switched off after repeated failed runs${detail}. Switch it on to run it again.`;
  }
  if (!source.isActive) {
    return `Source ${source.code} is switched off${detail}. Switch it on to run it.`;
  }
  return null;
}

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/sources - List all sources with health status and health summary
  app.get('/v1/sources', async (_request, reply) => {
    const [allSources, latestCanaries, listingCounts, lifecycleSummaries, latestRuns] =
      await Promise.all([
        sources.findAll(),
        canaryResults.findLatestPerSource(),
        sources.findListingCounts(),
        sources.findLifecycleSummaries(),
        scrapeRuns.findLatestFinishedPerSource(),
      ]);

    // Index latest canary results by source code for O(1) lookup
    const canaryBySource = new Map(latestCanaries.map((c) => [c.sourceCode, c]));
    const listingCountBySource = new Map(listingCounts.map((row) => [row.sourceId, row]));
    const lifecycleSummaryBySource = new Map(lifecycleSummaries.map((row) => [row.sourceId, row]));
    const latestRunBySource = new Map(latestRuns.map((run) => [run.sourceId, run]));

    const mappedData = await Promise.all(
      allSources.map(async (source) => {
        const lastCanary = canaryBySource.get(source.code) ?? null;
        const { successRate } = await scrapeRuns.getRecentSuccessRate(source.id);
        const listingCount = listingCountBySource.get(source.id)?.totalListingsIngested ?? 0;
        const lifecycleSummary = lifecycleSummaryBySource.get(source.id);
        const latestRun = latestRunBySource.get(source.id);

        return {
          id: source.id,
          code: source.code,
          name: source.name,
          baseUrl: source.baseUrl,
          countryCode: source.countryCode,
          scrapeMode: source.scrapeMode,
          isActive: source.isActive,
          healthStatus: source.healthStatus,
          crawlIntervalMinutes: source.crawlIntervalMinutes,
          priority: source.priority,
          rateLimitRpm: source.rateLimitRpm,
          concurrencyLimit: source.concurrencyLimit,
          parserVersion: source.parserVersion,
          legalStatus: source.legalStatus,
          disabledReason: sources.disabledReasonOf(source),
          lastSuccessfulRun: source.lastSuccessfulRunAt?.toISOString() ?? null,
          lastSuccessfulRunAt: source.lastSuccessfulRunAt?.toISOString() ?? null,
          // The latest finished run's error: the canary is off by default, so its result is stale.
          lastErrorSummary:
            latestRun && latestRun.status !== 'succeeded' ? latestRun.errorMessage : null,
          totalListingsIngested: listingCount,
          successRatePct: Math.round(successRate * 1000) / 10,
          lifecycleSummary: {
            explicitDead24h: lifecycleSummary?.explicitDead24h ?? 0,
            explicitDead7d: lifecycleSummary?.explicitDead7d ?? 0,
            staleExpired24h: lifecycleSummary?.staleExpired24h ?? 0,
            staleExpired7d: lifecycleSummary?.staleExpired7d ?? 0,
            lastExplicitDeadAt: lifecycleSummary?.lastExplicitDeadAt?.toISOString() ?? null,
            lastStaleExpiredAt: lifecycleSummary?.lastStaleExpiredAt?.toISOString() ?? null,
          },
          createdAt: source.createdAt.toISOString(),
          updatedAt: source.updatedAt.toISOString(),
          healthSummary: {
            lastCanary: lastCanary
              ? {
                  success: lastCanary.success,
                  discoveryOk: lastCanary.discoveryOk,
                  detailOk: lastCanary.detailOk,
                  ingestionOk: lastCanary.ingestionOk,
                  scoringOk: lastCanary.scoringOk,
                  durationMs: lastCanary.durationMs,
                  errorMessage: lastCanary.errorMessage,
                  createdAt: lastCanary.createdAt.toISOString(),
                }
              : null,
            recentSuccessRate: successRate,
          },
        };
      }),
    );

    return reply.send({
      data: mappedData,
      meta: {},
    });
  });

  // PATCH /v1/sources/:id - Update source settings (isActive, crawlIntervalMinutes).
  // Switching on a legally disabled source fails with 409 and changes nothing.
  app.patch<{ Params: { id: string } }>('/v1/sources/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { isActive, crawlIntervalMinutes } = parseOrThrow(sourceUpdateSchema, request.body);

    const result = await sources.updateSettings(id, { isActive, crawlIntervalMinutes });
    if (result.outcome === 'not_found') {
      throw new NotFoundError('Source', id);
    }
    if (result.outcome === 'legally_disabled') {
      throw new ConflictError(
        `Source ${result.source.code} is legally disabled and can't be switched on.`,
      );
    }
    const updated = result.source;

    await syncDiscoverySchedule(getDiscoveryQueue(), updated, loadConfig());

    return reply.send({
      data: {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        baseUrl: updated.baseUrl,
        countryCode: updated.countryCode,
        scrapeMode: updated.scrapeMode,
        isActive: updated.isActive,
        healthStatus: updated.healthStatus,
        crawlIntervalMinutes: updated.crawlIntervalMinutes,
        priority: updated.priority,
        rateLimitRpm: updated.rateLimitRpm,
        concurrencyLimit: updated.concurrencyLimit,
        parserVersion: updated.parserVersion,
        legalStatus: updated.legalStatus,
        lastSuccessfulRunAt: updated.lastSuccessfulRunAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      meta: {},
    });
  });

  // POST /v1/sources/pause-all - Pause all sources
  app.post('/v1/sources/pause-all', async (_request, reply) => {
    const affected = await sources.updateAllActive(false);
    await syncAllDiscoverySchedules();
    return reply.send({ data: { affected }, meta: {} });
  });

  // POST /v1/sources/resume-all - Resume all sources except legally disabled ones
  app.post('/v1/sources/resume-all', async (_request, reply) => {
    const affected = await sources.updateAllActive(true);
    await syncAllDiscoverySchedules();
    return reply.send({ data: { affected }, meta: {} });
  });

  // GET /v1/sources/:code/canary-history - Recent canary results for a source
  app.get<{ Params: { code: string } }>(
    '/v1/sources/:code/canary-history',
    async (request, reply) => {
      const { code } = request.params;
      const { limit } = parseOrThrow(canaryHistoryQuerySchema, request.query);

      // Verify the source exists
      const source = await sources.findByCode(code);
      if (!source) {
        throw new NotFoundError('Source', code);
      }

      const results = await canaryResults.findBySourceCode(code, limit);

      const mappedData = results.map((r) => ({
        id: r.id,
        sourceCode: r.sourceCode,
        success: r.success,
        discoveryOk: r.discoveryOk,
        detailOk: r.detailOk,
        ingestionOk: r.ingestionOk,
        scoringOk: r.scoringOk,
        listingsFound: r.listingsFound,
        durationMs: r.durationMs,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      }));

      return reply.send({
        data: mappedData,
        meta: { total: mappedData.length },
      });
    },
  );

  // ── Scrape run mapping helper ──────────────────────────────────────────────

  function mapRun(run: {
    id: number;
    sourceId: number;
    sourceCode?: string;
    status: string;
    scope: string;
    triggerType: string;
    seedName: string | null;
    pagesFetched: number;
    listingsDiscovered: number;
    rawSnapshotsCreated: number;
    normalizedCreated: number;
    normalizedUpdated: number;
    http2xx: number;
    http4xx: number;
    http5xx: number;
    captchaCount: number;
    retryCount: number;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: run.id,
      sourceId: run.sourceId,
      ...(run.sourceCode !== undefined ? { sourceCode: run.sourceCode } : {}),
      status: run.status,
      scope: run.scope,
      triggerType: run.triggerType,
      seedName: run.seedName,
      pagesFetched: run.pagesFetched,
      listingsDiscovered: run.listingsDiscovered,
      rawSnapshotsCreated: run.rawSnapshotsCreated,
      normalizedCreated: run.normalizedCreated,
      normalizedUpdated: run.normalizedUpdated,
      http2xx: run.http2xx,
      http4xx: run.http4xx,
      http5xx: run.http5xx,
      captchaCount: run.captchaCount,
      retryCount: run.retryCount,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  // GET /v1/scrape-runs - List recent scrape runs
  app.get('/v1/scrape-runs', async (request, reply) => {
    const { limit: rawLimit } = parseOrThrow(paginationQuerySchema, request.query);
    const limit = rawLimit ?? 20;

    const runs = await scrapeRuns.findRecentAll(null, limit);

    return reply.send({
      data: runs.map(mapRun),
      meta: {},
    });
  });

  // GET /v1/scrape-runs/:id - Fetch a single scrape run by ID
  app.get<{ Params: { id: string } }>('/v1/scrape-runs/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const run = await scrapeRuns.findById(id);
    if (!run) {
      throw new NotFoundError('ScrapeRun', id);
    }
    return reply.send({ data: mapRun(run), meta: {} });
  });

  // POST /v1/scrape-runs/:id/cancel - Cancel a running scrape run
  app.post<{ Params: { id: string } }>('/v1/scrape-runs/:id/cancel', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const run = await scrapeRuns.findById(id);
    if (!run) {
      throw new NotFoundError('ScrapeRun', id);
    }

    const terminalStatuses = ['succeeded', 'failed', 'cancelled', 'partial', 'rate_limited'];
    if (terminalStatuses.includes(run.status)) {
      throw new ConflictError(`Scrape run ${id} is already in terminal status '${run.status}'`);
    }

    // The run can end between the read above and this update, which then changes nothing.
    const cancelled = await scrapeRuns.cancel(id);
    if (!cancelled) {
      throw new ConflictError(`Scrape run ${id} ended before it could be cancelled.`);
    }
    return reply.send({ data: { id, status: 'cancelled' }, meta: {} });
  });

  // POST /v1/scrape-runs - Create a scrape run and enqueue discovery job
  app.post('/v1/scrape-runs', async (request, reply) => {
    const { sourceCode } = parseOrThrow(scrapeRunCreateSchema, request.body);

    // Validate the source exists
    const source = await sources.findByCode(sourceCode);
    if (!source) {
      throw new NotFoundError('Source', sourceCode);
    }
    // The scraper's source guard would drop the run, so refuse it before creating one.
    const refusal = runRefusal(source);
    if (refusal) {
      throw new ConflictError(refusal);
    }

    const queue = getDiscoveryQueue();
    await withTimeout(
      queue.waitUntilReady(),
      SCRAPE_QUEUE_READY_TIMEOUT_MS,
      () =>
        new TransientError(SCRAPE_QUEUE_UNAVAILABLE_MESSAGE, 'scrape_queue_unavailable', {
          sourceCode: source.code,
        }),
    );

    // Create scrape run record
    const run = await scrapeRuns.create({
      sourceId: source.id,
      triggerType: 'manual',
      scope: 'full',
      workerHost: 'api',
      workerVersion: '1.0.0',
      browserType: 'chromium',
    });

    const maxPagesPerRun = maxPagesForSource(source.config, loadConfig().scraper.maxPagesPerRun);

    try {
      await queue.add(`discovery:${source.code}`, {
        sourceCode: source.code,
        sourceId: source.id,
        scrapeRunId: run.id,
        page: 1,
        maxPages: maxPagesPerRun, // legacy field, kept for compat
        maxPagesPerRun,
      });
    } catch (error) {
      logger.error('Failed to enqueue manual scrape run', {
        sourceCode: source.code,
        scrapeRunId: run.id,
        sourceId: source.id,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        error: error instanceof Error ? error.message : String(error),
      });

      await scrapeRuns.finish(run.id, 'failed', EMPTY_SCRAPE_RUN_METRICS, {
        errorCode: 'scrape_queue_unavailable',
        errorMessage: SCRAPE_QUEUE_UNAVAILABLE_MESSAGE,
      });

      throw new TransientError(SCRAPE_QUEUE_UNAVAILABLE_MESSAGE, 'scrape_queue_unavailable', {
        sourceCode: source.code,
        scrapeRunId: run.id,
      });
    }

    return reply.status(201).send({
      data: {
        id: run.id,
        runUuid: run.runUuid,
        sourceId: run.sourceId,
        sourceCode: source.code,
        status: run.status,
        scope: run.scope,
        triggerType: run.triggerType,
        startedAt: run.startedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
      },
      meta: {},
    });
  });

  // The dead-letter view reads these queues. They share the process's Redis connection, so they're
  // created on first use and kept until the app closes, instead of six new ones per request that
  // stayed open whenever a read failed.
  const failedJobQueueNames: QueueName[] = [
    QUEUE_NAMES.SCRAPE_DISCOVERY,
    QUEUE_NAMES.SCRAPE_DETAIL,
    QUEUE_NAMES.PROCESSING,
    QUEUE_NAMES.BASELINE,
    QUEUE_NAMES.GEOCODING,
    QUEUE_NAMES.RESCORE,
  ];
  let failedJobQueues: Map<QueueName, Queue<unknown>> | null = null;
  const getFailedJobQueues = (): Map<QueueName, Queue<unknown>> => {
    failedJobQueues ??= new Map(
      failedJobQueueNames.map((name) => [name, createQueue<unknown>(name)]),
    );
    return failedJobQueues;
  };
  app.addHook('onClose', async () => {
    const queues = failedJobQueues;
    failedJobQueues = null;
    if (queues) await Promise.all([...queues.values()].map((queue) => queue.close()));
  });

  // GET /v1/dead-letter-queue — List failed jobs across all queues
  app.get(
    '/v1/dead-letter-queue',
    {
      schema: {
        tags: ['Reliability'],
        summary: 'List failed BullMQ jobs',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { limit: queryLimit } = parseOrThrow(paginationQuerySchema, request.query);
      const limit = queryLimit ?? 20;

      const allFailed: Array<{
        jobId: string;
        queue: string;
        name: string;
        error: string;
        failedAt: string | null;
        attempts: number;
      }> = [];

      for (const [queueName, q] of getFailedJobQueues()) {
        // The end index is inclusive.
        const failed = await q.getFailed(0, limit - 1);
        for (const job of failed) {
          allFailed.push({
            jobId: job.id ?? 'unknown',
            queue: queueName,
            name: job.name,
            error: job.failedReason ?? 'unknown',
            failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            attempts: job.attemptsMade,
          });
        }
      }

      // Sort by most recent failure first
      allFailed.sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''));

      return reply.send({
        data: allFailed.slice(0, limit),
        meta: { total: allFailed.length },
      });
    },
  );
}
