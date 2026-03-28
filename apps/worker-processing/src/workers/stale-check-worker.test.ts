import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  processor: null as ((job: { data: { thresholdDays?: number; batchSize?: number } }) => Promise<void>) | null,
  on: vi.fn(),
  findStaleActive: vi.fn(),
  updateLifecycleStatus: vi.fn(),
  appendVersion: vi.fn(),
  computeContentFingerprint: vi.fn(() => 'expired-fingerprint'),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _queueName: string,
      processor: (job: { data: { thresholdDays?: number; batchSize?: number } }) => Promise<void>,
    ) {
      hoisted.processor = processor;
      return {
        on: hoisted.on,
      };
    }
  },
}));

vi.mock('@immoradar/scraper-core', () => ({
  QUEUE_NAMES: {
    STALE_CHECK: 'processing-stale-check',
  },
  getRedisConnection: () => ({}),
  getQueuePrefix: () => 'test',
}));

vi.mock('@immoradar/normalization', () => ({
  computeContentFingerprint: hoisted.computeContentFingerprint,
}));

vi.mock('@immoradar/db', async () => {
  const actual = await vi.importActual<typeof import('@immoradar/db')>('@immoradar/db');
  return {
    ...actual,
    listings: {
      ...actual.listings,
      findStaleActive: hoisted.findStaleActive,
      updateLifecycleStatus: hoisted.updateLifecycleStatus,
    },
    listingVersions: {
      ...actual.listingVersions,
      appendVersion: hoisted.appendVersion,
    },
  };
});

import { createStaleCheckWorker } from './stale-check-worker.js';

describe('createStaleCheckWorker', () => {
  beforeEach(() => {
    hoisted.processor = null;
    hoisted.on.mockReset();
    hoisted.findStaleActive.mockReset();
    hoisted.updateLifecycleStatus.mockReset();
    hoisted.appendVersion.mockReset();
    hoisted.computeContentFingerprint.mockClear();
  });

  it('expires stale listings silently and writes the expired fingerprint to the version', async () => {
    hoisted.findStaleActive
      .mockResolvedValueOnce([
        {
          id: 123,
          title: 'Sunny flat',
          description: 'Great light',
          listPriceEurCents: 29900000,
          livingAreaSqm: 58.4,
          usableAreaSqm: null,
          rooms: 3,
          propertyType: 'apartment',
          propertySubtype: null,
          districtNo: 2,
          postalCode: '1020',
          city: 'Wien',
          contactName: 'Broker',
          contactCompany: 'Broker GmbH',
          contactEmail: 'broker@example.com',
          contactPhone: '123',
          hasBalcony: true,
          hasTerrace: false,
          hasGarden: false,
          hasElevator: true,
          parkingAvailable: false,
          isFurnished: false,
          currentRawListingId: 500,
          latestScrapeRunId: 900,
          contentFingerprint: 'active-fingerprint',
          normalizedPayload: { foo: 'bar' },
          pricePerSqmEur: 5119.86,
        },
      ])
      .mockResolvedValueOnce([]);
    hoisted.updateLifecycleStatus.mockResolvedValue({ id: 123 });
    hoisted.appendVersion.mockResolvedValue({ id: 999, versionNo: 4 });

    createStaleCheckWorker();

    expect(hoisted.processor).toBeTypeOf('function');

    await hoisted.processor?.({
      data: {
        thresholdDays: 7,
        batchSize: 10,
      },
    });

    expect(hoisted.findStaleActive).toHaveBeenNthCalledWith(1, 7, 10);
    expect(hoisted.updateLifecycleStatus).toHaveBeenCalledWith({
      id: 123,
      currentRawListingId: 500,
      latestScrapeRunId: 900,
      listingStatus: 'expired',
      sourceStatusRaw: 'expired_stale',
      contentFingerprint: 'expired-fingerprint',
    });
    expect(hoisted.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: 123,
        versionReason: 'status_change',
        listingStatus: 'expired',
        contentFingerprint: 'expired-fingerprint',
        normalizedSnapshot: {
          foo: 'bar',
          listingStatus: 'expired',
          sourceStatusRaw: 'expired_stale',
        },
      }),
    );
  });
});
