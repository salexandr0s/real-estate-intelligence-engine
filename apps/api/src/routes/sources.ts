import type { FastifyInstance } from 'fastify';
import { sources, scrapeRuns } from '@rei/db';

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
    const query = request.query as Record<string, unknown>;
    const limit = query['limit'] != null ? parseInt(String(query['limit']), 10) : undefined;

    const runs = await scrapeRuns.findRecentAll(null, limit ?? 20);

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
}
