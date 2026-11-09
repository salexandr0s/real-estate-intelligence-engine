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
  findLatestFinishedPerSource: vi.fn(),
  createScrapeRun: vi.fn(),
  findRunById: vi.fn(),
  cancelRun: vi.fn(),
  findLatestPerSource: vi.fn(),
  findBySourceCode: vi.fn(),
}));

vi.mock('@immoradar/scraper-core', () => ({
  QUEUE_NAMES: {
    SCRAPE_DISCOVERY: 'scrape-discovery',
  },
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
      findLatestFinishedPerSource: hoisted.findLatestFinishedPerSource,
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

import { registerErrorHandler } from '../../apps/api/src/middleware/error-handler.ts';
import { sourceRoutes } from '../../apps/api/src/routes/sources.ts';

async function buildTestApp() {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(sourceRoutes);
  return app;
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(hoisted)) mock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /v1/sources', () => {
  it('returns every source with the fields the macOS app reads and why a source is off', async () => {
    hoisted.findAll.mockResolvedValue([
      sourceRow({
        id: 1,
        code: 'willhaben',
        name: 'willhaben.at',
        baseUrl: 'https://www.willhaben.at',
        healthStatus: 'healthy',
        priority: 10,
        lastSuccessfulRunAt: new Date('2026-03-28T08:00:00.000Z'),
      }),
      sourceRow(),
      sourceRow({
        id: 3,
        code: 'wohnnet',
        isActive: false,
        healthStatus: 'disabled',
        config: { disabledReason: 'captcha: 5 failed runs in a row, last on 2026-03-27' },
      }),
    ]);
    hoisted.findListingCounts.mockResolvedValue([{ sourceId: 1, totalListingsIngested: 1234 }]);
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
    // Stale canary errors: the summary must come from the runs instead.
    hoisted.findLatestPerSource.mockResolvedValue([
      {
        sourceCode: 'willhaben',
        success: false,
        discoveryOk: false,
        detailOk: false,
        ingestionOk: false,
        scoringOk: false,
        durationMs: 1234,
        errorMessage: 'Canary timed out',
        createdAt: new Date('2026-03-20T08:30:00.000Z'),
      },
    ]);
    hoisted.findLatestFinishedPerSource.mockResolvedValue([
      { sourceId: 1, status: 'succeeded', errorMessage: null },
      { sourceId: 2, status: 'failed', errorMessage: 'Blocked by CAPTCHA' },
    ]);
    const successRates = new Map([
      [1, 0.875],
      [2, 0.4],
    ]);
    hoisted.getRecentSuccessRate.mockImplementation(async (sourceId: number) => ({
      successRate: successRates.get(sourceId) ?? 0,
      totalRuns: 20,
    }));

    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/v1/sources' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toMatchObject({
      code: 'willhaben',
      lastSuccessfulRun: '2026-03-28T08:00:00.000Z',
      lastErrorSummary: null,
      disabledReason: null,
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
    expect(body.data[2]).toMatchObject({
      code: 'wohnnet',
      isActive: false,
      healthStatus: 'disabled',
      legalStatus: 'review_required',
      disabledReason: 'captcha: 5 failed runs in a row, last on 2026-03-27',
      lastErrorSummary: null,
    });

    await app.close();
  });
});

describe('scrape-run routes', () => {
  it.each([
    ['legally disabled', { legalStatus: 'disabled', isActive: false }, /legally disabled/],
    [
      'disabled by failed runs',
      {
        healthStatus: 'disabled',
        isActive: false,
        config: { disabledReason: 'captcha: 5 failed runs in a row' },
      },
      /captcha: 5 failed runs in a row/,
    ],
    ['switched off', { isActive: false }, /switched off/],
  ])('refuses a manual run for a source that is %s', async (_label, overrides, message) => {
    hoisted.findByCode.mockResolvedValue(sourceRow(overrides));

    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/scrape-runs',
      payload: { sourceCode: 'remax' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'conflict', message: expect.stringMatching(message) },
    });
    expect(hoisted.createScrapeRun).not.toHaveBeenCalled();
    await app.close();
  });

  it('answers a cancel for a run that already ended with the standard 409 envelope', async () => {
    hoisted.findRunById.mockResolvedValue({ id: 7, status: 'succeeded' });

    const app = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/v1/scrape-runs/7/cancel' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'conflict', message: expect.stringContaining('succeeded') },
    });
    expect(hoisted.cancelRun).not.toHaveBeenCalled();
    await app.close();
  });
});
