import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  findAll: vi.fn(),
  findListingCounts: vi.fn(),
  findLifecycleSummaries: vi.fn(),
  findById: vi.fn(),
  updateSettings: vi.fn(),
  updateAllActive: vi.fn(),
  findByCode: vi.fn(),
  getRecentSuccessRate: vi.fn(),
  findRecentAll: vi.fn(),
  createScrapeRun: vi.fn(),
  findRunById: vi.fn(),
  cancelRun: vi.fn(),
  findLatestPerSource: vi.fn(),
  findBySourceCode: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    removeJobScheduler = vi.fn();
    upsertJobScheduler = vi.fn();
    add = vi.fn();
  },
}));

vi.mock('@immoradar/scraper-core', () => ({
  QUEUE_NAMES: {
    SCRAPE_DISCOVERY: 'scrape-discovery',
  },
  getRedisConnection: () => ({}),
  getQueuePrefix: () => 'test',
}));

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');
  return {
    ...actual,
    sources: {
      ...actual.sources,
      findAll: hoisted.findAll,
      findListingCounts: hoisted.findListingCounts,
      findLifecycleSummaries: hoisted.findLifecycleSummaries,
      findById: hoisted.findById,
      updateSettings: hoisted.updateSettings,
      updateAllActive: hoisted.updateAllActive,
      findByCode: hoisted.findByCode,
    },
    scrapeRuns: {
      ...actual.scrapeRuns,
      getRecentSuccessRate: hoisted.getRecentSuccessRate,
      findRecentAll: hoisted.findRecentAll,
      create: hoisted.createScrapeRun,
      findById: hoisted.findRunById,
      cancel: hoisted.cancelRun,
    },
    canaryResults: {
      ...actual.canaryResults,
      findLatestPerSource: hoisted.findLatestPerSource,
      findBySourceCode: hoisted.findBySourceCode,
    },
  };
});

import { sourceRoutes } from '../../apps/api/src/routes/sources.ts';

describe('GET /v1/sources', () => {
  beforeEach(() => {
    hoisted.findAll.mockReset();
    hoisted.findListingCounts.mockReset();
    hoisted.findLifecycleSummaries.mockReset();
    hoisted.findById.mockReset();
    hoisted.updateSettings.mockReset();
    hoisted.updateAllActive.mockReset();
    hoisted.findByCode.mockReset();
    hoisted.getRecentSuccessRate.mockReset();
    hoisted.findRecentAll.mockReset();
    hoisted.createScrapeRun.mockReset();
    hoisted.findRunById.mockReset();
    hoisted.cancelRun.mockReset();
    hoisted.findLatestPerSource.mockReset();
    hoisted.findBySourceCode.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns lifecycleSummary per source and preserves top-level source stats used by the macOS app', async () => {
    hoisted.findAll.mockResolvedValue([
      {
        id: 1,
        code: 'willhaben',
        name: 'willhaben.at',
        baseUrl: 'https://www.willhaben.at',
        countryCode: 'AT',
        scrapeMode: 'browser',
        isActive: true,
        healthStatus: 'healthy',
        crawlIntervalMinutes: 360,
        priority: 10,
        rateLimitRpm: 10,
        concurrencyLimit: 1,
        parserVersion: 2,
        legalStatus: 'review_required',
        config: {},
        lastSuccessfulRunAt: new Date('2026-03-28T08:00:00.000Z'),
        createdAt: new Date('2026-03-01T08:00:00.000Z'),
        updatedAt: new Date('2026-03-28T08:00:00.000Z'),
      },
      {
        id: 2,
        code: 'remax',
        name: 'Remax',
        baseUrl: 'https://www.remax.at',
        countryCode: 'AT',
        scrapeMode: 'browser',
        isActive: true,
        healthStatus: 'degraded',
        crawlIntervalMinutes: 360,
        priority: 20,
        rateLimitRpm: 10,
        concurrencyLimit: 1,
        parserVersion: 2,
        legalStatus: 'review_required',
        config: {},
        lastSuccessfulRunAt: null,
        createdAt: new Date('2026-03-01T08:00:00.000Z'),
        updatedAt: new Date('2026-03-28T08:00:00.000Z'),
      },
    ]);
    hoisted.findListingCounts.mockResolvedValue([
      { sourceId: 1, totalListingsIngested: 1234 },
    ]);
    hoisted.findLifecycleSummaries.mockResolvedValue([
      {
        sourceId: 1,
        explicitDead24h: 2,
        explicitDead7d: 6,
        staleExpired24h: 1,
        staleExpired7d: 4,
        lastExplicitDeadAt: new Date('2026-03-28T09:00:00.000Z'),
        lastStaleExpiredAt: new Date('2026-03-28T07:00:00.000Z'),
      },
    ]);
    hoisted.findLatestPerSource.mockResolvedValue([
      {
        sourceCode: 'willhaben',
        success: true,
        discoveryOk: true,
        detailOk: true,
        ingestionOk: true,
        scoringOk: true,
        durationMs: 1234,
        errorMessage: null,
        createdAt: new Date('2026-03-28T08:30:00.000Z'),
      },
      {
        sourceCode: 'remax',
        success: false,
        discoveryOk: false,
        detailOk: false,
        ingestionOk: false,
        scoringOk: false,
        durationMs: 5000,
        errorMessage: 'Blocked by CAPTCHA',
        createdAt: new Date('2026-03-28T08:40:00.000Z'),
      },
    ]);
    hoisted.getRecentSuccessRate
      .mockResolvedValueOnce({ successRate: 0.875, totalRuns: 20 })
      .mockResolvedValueOnce({ successRate: 0.4, totalRuns: 20 });

    const app = Fastify();
    await app.register(sourceRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/sources',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      code: 'willhaben',
      lastSuccessfulRun: '2026-03-28T08:00:00.000Z',
      totalListingsIngested: 1234,
      successRatePct: 87.5,
      lifecycleSummary: {
        explicitDead24h: 2,
        explicitDead7d: 6,
        staleExpired24h: 1,
        staleExpired7d: 4,
        lastExplicitDeadAt: '2026-03-28T09:00:00.000Z',
        lastStaleExpiredAt: '2026-03-28T07:00:00.000Z',
      },
    });
    expect(body.data[1]).toMatchObject({
      code: 'remax',
      lastErrorSummary: 'Blocked by CAPTCHA',
      totalListingsIngested: 0,
      successRatePct: 40,
      lifecycleSummary: {
        explicitDead24h: 0,
        explicitDead7d: 0,
        staleExpired24h: 0,
        staleExpired7d: 0,
        lastExplicitDeadAt: null,
        lastStaleExpiredAt: null,
      },
    });

    await app.close();
  });
});
