import type { FastifyInstance } from 'fastify';
import { sources, scrapeRuns, marketBaselines, deadLetter, canaryResults } from '@rei/db';

const APP_VERSION = process.env['npm_package_version'] ?? '0.1.0';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
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

      // Per-source health with last scrape info
      const sourceStatuses = await Promise.all(
        activeSources.map(async (source) => {
          const recentRuns = await scrapeRuns.findRecent(source.id, 1);
          const lastRun = recentRuns[0] ?? null;
          const lastRunAgeHours = lastRun?.finishedAt
            ? (now - lastRun.finishedAt.getTime()) / 3_600_000
            : null;

          const canary = canaryLatest.find((c) => c.sourceCode === source.code);

          return {
            code: source.code,
            healthStatus: source.healthStatus,
            lastRunStatus: lastRun?.status ?? null,
            lastRunAgeHours: lastRunAgeHours != null ? Math.round(lastRunAgeHours * 10) / 10 : null,
            lastRunListingsDiscovered: lastRun?.listingsDiscovered ?? null,
            stale: lastRunAgeHours != null && lastRunAgeHours > 2,
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

      const healthySources = sourceStatuses.filter((s) => s.healthStatus === 'healthy').length;
      const staleSources = sourceStatuses.filter((s) => s.stale).length;

      const overallStatus =
        healthySources === 0
          ? 'critical'
          : staleSources > activeSources.length / 2 ||
              (baselineAgeHours != null && baselineAgeHours > 4)
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
          stale: baselineAgeHours != null && baselineAgeHours > 4,
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
