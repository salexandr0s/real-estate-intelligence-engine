import { describe, expect, it, vi } from 'vitest';
import { FullIngestionPipeline } from './pipeline.js';
import type {
  SourceNormalizer,
  DetailCapture,
  SourceRawListingBase,
  NormalizationContext,
  NormalizationResult,
} from '@immoradar/contracts';

class TestNormalizer implements SourceNormalizer {
  readonly sourceCode = 'edikte';
  readonly normalizationVersion = 1;

  normalize(_rawPayload: SourceRawListingBase, _context: NormalizationContext): NormalizationResult {
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
        currentRawListingId: 11,
        latestScrapeRunId: 99,
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
        listPriceEurCents: 100_000,
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
        contentFingerprint: 'fingerprint-1',
        normalizedPayload: {},
        normalizationVersion: 1,
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
          upsertListing: vi.fn().mockResolvedValue({ id: 22, isNew: true }),
          appendListingVersion: vi.fn().mockResolvedValue({ id: 33, versionNo: 1 }),
          updateScrapeRunNormalizationCounts: vi.fn().mockResolvedValue(undefined),
        },
        scoreAndAlert: {
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
        },
        persistAttachments,
      },
    ),
    persistAttachments,
  };
}

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

    expect(persistAttachments).toHaveBeenCalledWith(22, [
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
