import type { FastifyInstance } from 'fastify';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { NotFoundError } from '@rei/observability';
import { sources, scrapeRuns } from '@rei/db';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@rei/scraper-core';
import type { DiscoveryJobData } from '@rei/scraper-core';
import {
  parseOrThrow,
  idParamSchema,
  paginationQuerySchema,
  scrapeRunCreateSchema,
  sourceUpdateSchema,
} from '../schemas.js';

// Lazily-initialized shared queue for discovery jobs (avoids one Redis connection per request)
let discoveryQueue: Queue<DiscoveryJobData> | null = null;

function getDiscoveryQueue(): Queue<DiscoveryJobData> {
  if (!discoveryQueue) {
    const connection = getRedisConnection() as ConnectionOptions;
    const prefix = getQueuePrefix();
    discoveryQueue = new Queue<DiscoveryJobData>(QUEUE_NAMES.SCRAPE_DISCOVERY, {
      connection,
      prefix,
    });
  }
  return discoveryQueue;
}

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/sources - List all sources with health status
  app.get('/v1/sources', async (_request, reply) => {
    const allSources = await sources.findAll();

    const mappedData = allSources.map((source) => ({
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
      lastSuccessfulRunAt: source.lastSuccessfulRunAt?.toISOString() ?? null,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    }));

    return reply.send({
      data: mappedData,
      meta: {},
    });
  });

  // PATCH /v1/sources/:id - Update source (toggle is_active)
  app.patch<{ Params: { id: string } }>('/v1/sources/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { isActive } = parseOrThrow(sourceUpdateSchema, request.body);

    const existing = await sources.findById(id);
    if (!existing) {
      throw new NotFoundError('Source', id);
    }

    const updated = await sources.updateActive(id, isActive);
    if (!updated) {
      throw new NotFoundError('Source', id);
    }

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
    return reply.send({ data: { affected }, meta: {} });
  });

  // POST /v1/sources/resume-all - Resume all sources
  app.post('/v1/sources/resume-all', async (_request, reply) => {
    const affected = await sources.updateAllActive(true);
    return reply.send({ data: { affected }, meta: {} });
  });

  // GET /v1/scrape-runs - List recent scrape runs
  app.get('/v1/scrape-runs', async (request, reply) => {
    const { limit: rawLimit } = parseOrThrow(paginationQuerySchema, request.query);
    const limit = rawLimit ?? 20;

    const runs = await scrapeRuns.findRecentAll(null, limit);

    const mappedData = runs.map((run) => ({
      id: run.id,
      sourceId: run.sourceId,
      sourceCode: run.sourceCode,
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
    }));

    return reply.send({
      data: mappedData,
      meta: {},
    });
  });

  // POST /v1/scrape-runs - Create a scrape run and enqueue discovery job
  app.post('/v1/scrape-runs', async (request, reply) => {
    const { sourceCode } = parseOrThrow(scrapeRunCreateSchema, request.body);

    // Validate the source exists
    const source = await sources.findByCode(sourceCode);
    if (!source) {
      throw new NotFoundError('Source', sourceCode);
    }

    // Create scrape run record
    const run = await scrapeRuns.create({
      sourceId: source.id,
      triggerType: 'manual',
      scope: 'full',
      workerHost: 'api',
      workerVersion: '1.0.0',
      browserType: 'chromium',
    });
    await scrapeRuns.start(run.id);

    // Enqueue discovery job via BullMQ (shared queue instance)
    const queue = getDiscoveryQueue();

    const sourceConfig = source.config as Record<string, unknown> | null;
    const crawlProfile =
      typeof sourceConfig?.crawlProfile === 'object' && sourceConfig.crawlProfile != null
        ? (sourceConfig.crawlProfile as Record<string, unknown>)
        : undefined;
    const rawMaxPages = crawlProfile?.maxPages;
    const maxPages =
      typeof rawMaxPages === 'number' && !Number.isNaN(rawMaxPages) ? rawMaxPages : 3;

    await queue.add(`discovery:${source.code}`, {
      sourceCode: source.code,
      sourceId: source.id,
      scrapeRunId: run.id,
      page: 1,
      maxPages,
    });

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

      const connection = getRedisConnection() as ConnectionOptions;
      const prefix = getQueuePrefix();
      const queueNames = [
        QUEUE_NAMES.SCRAPE_DISCOVERY,
        QUEUE_NAMES.SCRAPE_DETAIL,
        QUEUE_NAMES.PROCESSING,
        QUEUE_NAMES.BASELINE,
        QUEUE_NAMES.GEOCODING,
        QUEUE_NAMES.RESCORE,
      ];

      const allFailed: Array<{
        jobId: string;
        queue: string;
        name: string;
        error: string;
        failedAt: string | null;
        attempts: number;
      }> = [];

      for (const queueName of queueNames) {
        const q = new Queue(queueName, { connection, prefix });
        const failed = await q.getFailed(0, limit);
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
        await q.close();
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
