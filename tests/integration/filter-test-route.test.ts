import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetConfig } from '@immoradar/config';

const AUTH_HEADER = { authorization: 'Bearer dev-token' };

const hoisted = vi.hoisted(() => ({
  findFilterById: vi.fn(),
  searchListings: vi.fn(),
}));

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');
  return {
    ...actual,
    userFilters: {
      ...actual.userFilters,
      findById: hoisted.findFilterById,
    },
    listings: {
      ...actual.listings,
      searchListings: hoisted.searchListings,
    },
  };
});

describe('POST /v1/filters/:id/test', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetConfig();
    const mod = await import('../../apps/api/src/app.js');
    app = await mod.buildApp();
    await app.ready();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes compiled keyword criteria through to the shared search path', async () => {
    hoisted.findFilterById.mockResolvedValue({
      id: 9,
      userId: 1,
      name: 'Garden hunt',
      filterKind: 'listing_search',
      isActive: true,
      operationType: 'sale',
      propertyTypes: ['apartment'],
      districts: [7],
      minPriceEurCents: 400_000_00,
      maxPriceEurCents: 500_000_00,
      minAreaSqm: 80,
      maxAreaSqm: 95,
      minRooms: 3,
      maxRooms: 4,
      minScore: 80,
      requiredKeywords: ['Garten'],
      excludedKeywords: ['Baurecht'],
      sortBy: 'score_desc',
      alertFrequency: 'manual',
      alertChannels: ['in_app'],
      createdAt: new Date('2026-04-08T09:00:00Z'),
      updatedAt: new Date('2026-04-08T09:00:00Z'),
    });
    hoisted.searchListings.mockResolvedValue({
      data: [
        {
          id: 101,
          listingUid: 'listing-101',
          sourceCode: 'willhaben',
          title: 'Sanierte Wohnung',
          canonicalUrl: 'https://example.com/listing-101',
          operationType: 'sale',
          propertyType: 'apartment',
          city: 'Wien',
          postalCode: '1070',
          districtNo: 7,
          districtName: 'Neubau',
          listPriceEurCents: 450_000_00,
          livingAreaSqm: 88,
          rooms: 3,
          pricePerSqmEur: 5113.64,
          currentScore: 84,
          firstSeenAt: new Date('2026-04-08T09:00:00Z'),
          lastSeenAt: new Date('2026-04-09T09:00:00Z'),
          listingStatus: 'active',
          latitude: null,
          longitude: null,
          geocodePrecision: null,
          lastPriceChangePct: -5,
          lastPriceChangeAt: new Date('2026-04-08T12:00:00Z'),
        },
      ],
      meta: {
        nextCursor: null,
        pageSize: 25,
        totalCount: 1,
      },
    });

    // The app sends this POST as JSON with no body.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/filters/9/test',
      headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      payload: '',
    });

    expect(res.statusCode).toBe(200);
    expect(hoisted.searchListings).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'sale',
        propertyTypes: ['apartment'],
        districts: [7],
        minPriceEurCents: 400_000_00,
        maxPriceEurCents: 500_000_00,
        minAreaSqm: 80,
        maxAreaSqm: 95,
        minRooms: 3,
        maxRooms: 4,
        minScore: 80,
        requiredKeywords: ['garten'],
        excludedKeywords: ['baurecht'],
      }),
      null,
    );
    // The dashboard counts price drops from these two fields.
    expect(res.json().data).toEqual([
      expect.objectContaining({
        id: 101,
        lastSeenAt: '2026-04-09T09:00:00.000Z',
        lastPriceChangePct: -5,
        lastPriceChangeAt: '2026-04-08T12:00:00.000Z',
      }),
    ]);
  });

  it('returns 404 for missing filters', async () => {
    hoisted.findFilterById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/filters/999/test',
      headers: AUTH_HEADER,
    });

    expect(res.statusCode).toBe(404);
    expect(hoisted.searchListings).not.toHaveBeenCalled();
  });
});
