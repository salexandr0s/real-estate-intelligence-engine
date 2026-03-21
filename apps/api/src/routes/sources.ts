import type { FastifyInstance } from 'fastify';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import { NotFoundError } from '@rei/observability';
import { sources, scrapeRuns } from '@rei/db';
import { QUEUE_NAMES, getRedisConnection, getQueuePrefix } from '@rei/scraper-core';
import type { DiscoveryJobData } from '@rei/scraper-core';
import { parseOrThrow, paginationQuerySchema, scrapeRunCreateSchema } from '../schemas.js';

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
}
