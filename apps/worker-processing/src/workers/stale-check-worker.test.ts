import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  processor: null as ((job: { data: { thresholdDays?: number } }) => Promise<void>) | null,
  on: vi.fn(),
  reconcileLastSeen: vi.fn(),
  findExpiryCandidates: vi.fn(),
  expireStale: vi.fn(),
  computeContentFingerprint: vi.fn(() => 'expired-fingerprint'),
  pruneFailureArtifacts: vi.fn(),
}));

vi.mock('@immoradar/config', () => ({
  loadConfig: () => ({
    artifacts: { dir: '/runtime/artifacts' },
    scraper: { artifactRetentionDays: 7 },
  }),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _queueName: string,
      processor: (job: { data: { thresholdDays?: number } }) => Promise<void>,
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
  WORKER_CONCURRENCY: 1,
  getRedisConnection: () => ({}),
  getQueuePrefix: () => 'test',
  pruneFailureArtifacts: hoisted.pruneFailureArtifacts,
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
      reconcileLastSeen: hoisted.reconcileLastSeen,
      findExpiryCandidates: hoisted.findExpiryCandidates,
      expireStale: hoisted.expireStale,
    },
  };
});

import { createStaleCheckWorker } from './stale-check-worker.js';

const candidate = {
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
};

describe('createStaleCheckWorker', () => {
  beforeEach(() => {
    hoisted.processor = null;
    hoisted.on.mockReset();
    hoisted.reconcileLastSeen.mockReset().mockResolvedValue(0);
    hoisted.findExpiryCandidates.mockReset();
    hoisted.expireStale.mockReset();
    hoisted.computeContentFingerprint.mockClear();
    hoisted.pruneFailureArtifacts
      .mockReset()
      .mockResolvedValue({ removedFiles: 0, removedBytes: 0 });
  });

  it('prunes failure artifacts with the configured retention', async () => {
    hoisted.findExpiryCandidates.mockResolvedValueOnce([]);

    createStaleCheckWorker();
    await hoisted.processor?.({ data: {} });

    expect(hoisted.pruneFailureArtifacts).toHaveBeenCalledWith('/runtime/artifacts', 7);
  });

  it('still runs the stale check when pruning fails', async () => {
    hoisted.pruneFailureArtifacts.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    hoisted.findExpiryCandidates.mockResolvedValueOnce([candidate]);
    hoisted.expireStale.mockResolvedValue(true);

    createStaleCheckWorker();
    await expect(hoisted.processor?.({ data: {} })).resolves.toBeUndefined();

    expect(hoisted.expireStale).toHaveBeenCalledTimes(1);
  });

  it('applies sightings first, then expires a candidate on the raw row it already has', async () => {
    hoisted.findExpiryCandidates.mockResolvedValueOnce([candidate]);
    hoisted.expireStale.mockResolvedValue(true);

    createStaleCheckWorker();
    await hoisted.processor?.({ data: { thresholdDays: 7 } });

    expect(hoisted.reconcileLastSeen.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.findExpiryCandidates.mock.invocationCallOrder[0]!,
    );
    expect(hoisted.findExpiryCandidates).toHaveBeenCalledWith(7);
    expect(hoisted.expireStale).toHaveBeenCalledWith({
      thresholdDays: 7,
      sourceStatusRaw: 'expired_revalidation_failed',
      version: expect.objectContaining({
        listingId: 123,
        rawListingId: 500,
        versionReason: 'status_change',
        listingStatus: 'expired',
        contentFingerprint: 'expired-fingerprint',
        normalizedSnapshot: {
          foo: 'bar',
          listingStatus: 'expired',
          sourceStatusRaw: 'expired_revalidation_failed',
        },
      }),
    });
  });

  it('makes one pass, so a listing that keeps failing cannot spin the job', async () => {
    hoisted.findExpiryCandidates.mockResolvedValue([candidate, { ...candidate, id: 124 }]);
    hoisted.expireStale.mockRejectedValue(new Error('update failed'));

    createStaleCheckWorker();
    await hoisted.processor?.({ data: {} });

    expect(hoisted.findExpiryCandidates).toHaveBeenCalledTimes(1);
    expect(hoisted.expireStale).toHaveBeenCalledTimes(2);
  });
});
