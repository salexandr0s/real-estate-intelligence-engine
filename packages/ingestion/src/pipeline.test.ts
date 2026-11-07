import { describe, expect, it, vi } from 'vitest';
import { FullIngestionPipeline } from './pipeline.js';
import type { NormalizationDeps } from './normalize-and-upsert.js';
import { CURRENT_NORMALIZATION_VERSION } from '@immoradar/contracts';
import type {
  CanonicalListingInput,
  SourceNormalizer,
  DetailCapture,
  SourceRawListingBase,
  NormalizationContext,
  NormalizationResult,
  VersionReason,
} from '@immoradar/contracts';

const LISTING_ID = 22;

/** Prices the listing from the captured price, so captures with different prices differ. */
class TestNormalizer implements SourceNormalizer {
  readonly sourceCode = 'edikte';
  readonly normalizationVersion = CURRENT_NORMALIZATION_VERSION;

  normalize(rawPayload: SourceRawListingBase, context: NormalizationContext): NormalizationResult {
    const priceEur = Number(String(rawPayload.priceRaw ?? 0).replace(/\./g, ''));
    return {
      success: true,
      errors: [],
      warnings: [],
      provenance: {},
      versionReason: 'first_seen',
      listing: {
        sourceId: 1,
        sourceListingKey: 'edikte:abc',
        sourceExternalId: null,
        currentRawListingId: context.rawListingId,
        latestScrapeRunId: context.scrapeRunId,
        canonicalUrl: 'https://example.test/listing',
        operationType: 'sale',
        propertyType: 'apartment',
        propertySubtype: null,
        listingStatus: 'active',
        sourceStatusRaw: null,
        title: 'Test listing',
        description: null,
        districtNo: 1,
        districtName: 'Innere Stadt',
        postalCode: '1010',
        city: 'Wien',
        federalState: 'Wien',
        street: null,
        houseNumber: null,
        addressDisplay: null,
        latitude: null,
        longitude: null,
        geocodePrecision: 'none',
        crossSourceFingerprint: null,
        listPriceEurCents: priceEur * 100,
        monthlyOperatingCostEurCents: null,
        reserveFundEurCents: null,
        commissionEurCents: null,
        livingAreaSqm: 50,
        usableAreaSqm: 50,
        balconyAreaSqm: null,
        terraceAreaSqm: null,
        gardenAreaSqm: null,
        rooms: 2,
        floorLabel: null,
        floorNumber: null,
        yearBuilt: null,
        conditionCategory: null,
        heatingType: null,
        energyCertificateClass: null,
        hasBalcony: false,
        hasTerrace: false,
        hasGarden: false,
        hasElevator: false,
        parkingAvailable: false,
        isFurnished: false,
        completenessScore: 80,
        contentFingerprint: `fingerprint-${priceEur}`,
        normalizedPayload: {},
        normalizationVersion: CURRENT_NORMALIZATION_VERSION,
      },
    };
  }
}

const baseCapture: DetailCapture<SourceRawListingBase> = {
  sourceCode: 'edikte',
  canonicalUrl: 'https://example.test/listing',
  detailUrl: 'https://example.test/listing',
  payload: {
    titleRaw: 'Test listing',
    priceRaw: '100.000',
    addressRaw: '1010 Wien',
    postalCodeRaw: '1010',
    cityRaw: 'Wien',
    federalStateRaw: 'Wien',
    propertyTypeRaw: 'Wohnung',
    operationTypeRaw: 'sale',
  },
  extractedAt: '2026-03-28T10:00:00.000Z',
  parserVersion: 1,
  extractionStatus: 'captured',
};

const priceCut: DetailCapture<SourceRawListingBase> = {
  ...baseCapture,
  payload: { ...baseCapture.payload, priceRaw: '95.000' },
};

function scoreAndAlertMocks() {
  return {
    findBaseline: vi.fn().mockResolvedValue({
      districtBaselinePpsqmEur: 2000,
      bucketBaselinePpsqmEur: 2000,
      bucketSampleSize: 5,
      fallbackLevel: 'exact',
    }),
    scoreListing: vi.fn().mockResolvedValue({
      version: 1,
      overallScore: 80,
      componentScores: {},
      explanation: {},
    }),
    persistScore: vi.fn().mockResolvedValue(undefined),
    updateListingScore: vi.fn().mockResolvedValue(undefined),
    findMatchingFilters: vi.fn().mockResolvedValue({ evaluatedIds: [], matched: [] }),
    updateEvaluatedAt: vi.fn().mockResolvedValue(undefined),
    updateMatchedAt: vi.fn().mockResolvedValue(undefined),
    createAlert: vi.fn().mockResolvedValue(null),
    findClusterFingerprint: vi.fn().mockResolvedValue(null),
    existsAlertForCluster: vi.fn().mockResolvedValue(false),
    findPreviousPrice: vi.fn().mockResolvedValue(null),
    computeProximity: vi.fn().mockResolvedValue(null),
    getListingCoordinates: vi.fn().mockResolvedValue(null),
    cacheNearestPois: vi.fn().mockResolvedValue(undefined),
    findLatestBaselineDate: vi.fn().mockResolvedValue(null),
    enqueueDelivery: vi.fn().mockResolvedValue(undefined),
  };
}

function createPipeline(persistAttachments = vi.fn()) {
  return {
    pipeline: new FullIngestionPipeline(
      new Map<string, SourceNormalizer>([['edikte', new TestNormalizer()]]),
      {
        raw: {
          upsertRawSnapshot: vi.fn().mockResolvedValue({ id: 11, isNew: true }),
          updateScrapeRunMetrics: vi.fn().mockResolvedValue(undefined),
          computeContentHash: vi.fn().mockReturnValue('hash-1'),
        },
        normalization: {
          findExistingListing: vi.fn().mockResolvedValue(null),
          upsertListing: vi.fn().mockResolvedValue({ id: LISTING_ID, isNew: true }),
          updateLifecycleStatus: vi.fn().mockResolvedValue({ id: LISTING_ID }),
          appendListingVersion: vi.fn().mockResolvedValue({ id: 33, versionNo: 1 }),
          updateScrapeRunNormalizationCounts: vi.fn().mockResolvedValue(undefined),
        },
        scoreAndAlert: scoreAndAlertMocks(),
        persistAttachments,
      },
    ),
    persistAttachments,
  };
}

interface StoredVersion {
  id: number;
  versionNo: number;
  rawListingId: number;
  versionReason: VersionReason;
}

type ExistingListing = NonNullable<Awaited<ReturnType<NormalizationDeps['findExistingListing']>>>;

function toExistingListing(listing: CanonicalListingInput): ExistingListing {
  return {
    id: LISTING_ID,
    contentFingerprint: listing.contentFingerprint,
    normalizationVersion: listing.normalizationVersion,
    listingStatus: listing.listingStatus,
    listPriceEurCents: listing.listPriceEurCents ?? null,
    firstSeenAt: new Date('2026-03-28T10:00:00.000Z'),
    lastPriceChangeAt: null,
    currentScore: null,
    title: listing.title,
    description: null,
    operationType: listing.operationType,
    propertyType: listing.propertyType,
    districtNo: 1,
    city: listing.city,
    livingAreaSqm: 50,
    usableAreaSqm: 50,
    rooms: 2,
    completenessScore: listing.completenessScore,
    canonicalUrl: listing.canonicalUrl,
    normalizedPayload: {},
    propertySubtype: null,
    postalCode: '1010',
    contactName: null,
    contactCompany: null,
    contactEmail: null,
    contactPhone: null,
    hasBalcony: false,
    hasTerrace: false,
    hasGarden: false,
    hasElevator: false,
    parkingAvailable: false,
    isFurnished: false,
  };
}

/** Keeps raw snapshots, the listing, its versions and their scores in memory, as the database would. */
function createStatefulPipeline() {
  const rawIdsByHash = new Map<string, number>();
  const versions: StoredVersion[] = [];
  const scoredVersionIds: number[] = [];
  let stored: CanonicalListingInput | null = null;

  const scoreAndAlert = scoreAndAlertMocks();
  scoreAndAlert.persistScore.mockImplementation(async (_listingId: number, versionId: number) => {
    scoredVersionIds.push(versionId);
  });

  const pipeline = new FullIngestionPipeline(
    new Map<string, SourceNormalizer>([['edikte', new TestNormalizer()]]),
    {
      raw: {
        upsertRawSnapshot: async (input) => {
          const known = rawIdsByHash.get(input.contentSha256);
          if (known != null) return { id: known, isNew: false };
          const id = 101 + rawIdsByHash.size;
          rawIdsByHash.set(input.contentSha256, id);
          return { id, isNew: true };
        },
        updateScrapeRunMetrics: async () => {},
        computeContentHash: (payload) => JSON.stringify(payload),
      },
      normalization: {
        findExistingListing: async () => (stored ? toExistingListing(stored) : null),
        upsertListing: async (input) => {
          const isNew = stored == null;
          stored = input;
          return { id: LISTING_ID, isNew };
        },
        updateLifecycleStatus: async () => ({ id: LISTING_ID }),
        appendListingVersion: async (input) => {
          const version: StoredVersion = {
            id: versions.length + 1,
            versionNo: versions.length + 1,
            rawListingId: input.rawListingId,
            versionReason: input.versionReason,
          };
          versions.push(version);
          return version;
        },
        updateScrapeRunNormalizationCounts: async () => {},
      },
      scoreAndAlert,
    },
  );

  return { pipeline, versions, scoredVersionIds, scoreAndAlert };
}

describe('FullIngestionPipeline listing versions', () => {
  it('appends a third version when a price cut is reverted', async () => {
    const { pipeline, versions, scoredVersionIds } = createStatefulPipeline();

    for (const capture of [baseCapture, priceCut, baseCapture]) {
      await pipeline.ingestDetailCapture(capture, 1, 99);
    }

    // The third capture matches the first one byte for byte and lands on its raw snapshot,
    // but the listing changed in between, so it gets a version and a score of its own.
    expect(versions).toEqual([
      { id: 1, versionNo: 1, rawListingId: 101, versionReason: 'first_seen' },
      { id: 2, versionNo: 2, rawListingId: 102, versionReason: 'price_change' },
      { id: 3, versionNo: 3, rawListingId: 101, versionReason: 'price_change' },
    ]);
    expect(scoredVersionIds).toEqual([1, 2, 3]);
  });
});

describe('FullIngestionPipeline attachment persistence', () => {
  it('persists attachment documents after listing ingestion succeeds', async () => {
    const persistAttachments = vi.fn().mockResolvedValue(undefined);
    const { pipeline } = createPipeline(persistAttachments);

    await pipeline.ingestDetailCapture(
      {
        ...baseCapture,
        attachmentUrls: [
          {
            url: 'https://example.test/expose.pdf',
            label: 'Expose',
            type: 'application/pdf',
          },
        ],
      },
      1,
      99,
    );

    expect(persistAttachments).toHaveBeenCalledWith(LISTING_ID, [
      {
        url: 'https://example.test/expose.pdf',
        label: 'Expose',
        type: 'application/pdf',
      },
    ]);
  });

  it('skips attachment persistence when no attachments were captured', async () => {
    const persistAttachments = vi.fn().mockResolvedValue(undefined);
    const { pipeline } = createPipeline(persistAttachments);

    await pipeline.ingestDetailCapture(baseCapture, 1, 99);

    expect(persistAttachments).not.toHaveBeenCalled();
  });
});
