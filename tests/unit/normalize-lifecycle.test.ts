import { describe, expect, it, vi } from 'vitest';
import { NormalizeAndUpsert } from '../../packages/ingestion/src/normalize-and-upsert.ts';
import { computeContentFingerprint } from '../../packages/normalization/src/canonical/fingerprint.ts';
import type {
  CanonicalListingInput,
  NormalizationContext,
  NormalizationResult,
  SourceNormalizer,
  SourceRawListingBase,
} from '../../packages/contracts/src/index.ts';

function makeListing(overrides: Partial<CanonicalListingInput> = {}): CanonicalListingInput {
  const base: CanonicalListingInput = {
    sourceId: 1,
    sourceListingKey: 'immoscout24:abc123',
    sourceExternalId: 'abc123',
    currentRawListingId: 500,
    latestScrapeRunId: 900,
    canonicalUrl: 'https://example.com/expose/abc123',
    operationType: 'sale',
    propertyType: 'apartment',
    propertySubtype: null,
    listingStatus: 'active',
    sourceStatusRaw: 'active',
    title: 'Sunny flat',
    description: 'Great light and layout',
    city: 'Wien',
    federalState: 'Wien',
    postalCode: '1020',
    districtNo: 2,
    districtName: 'Leopoldstadt',
    street: 'Praterstraße',
    houseNumber: '1',
    addressDisplay: 'Praterstraße 1, 1020 Wien',
    latitude: null,
    longitude: null,
    geocodePrecision: null,
    listPriceEurCents: 29900000,
    monthlyOperatingCostEurCents: null,
    reserveFundEurCents: null,
    commissionEurCents: null,
    livingAreaSqm: 58.4,
    usableAreaSqm: null,
    balconyAreaSqm: null,
    terraceAreaSqm: null,
    gardenAreaSqm: null,
    rooms: 3,
    floorLabel: null,
    floorNumber: null,
    yearBuilt: null,
    conditionCategory: null,
    heatingType: null,
    energyCertificateClass: null,
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
    crossSourceFingerprint: null,
    normalizedPayload: { provenance: { title: 'payload.titleRaw' } },
    completenessScore: 85,
    contentFingerprint: '',
    normalizationVersion: 2,
    ...overrides,
  };
  base.contentFingerprint = computeContentFingerprint(base);
  return base;
}

function makeExistingListing(overrides: Record<string, unknown> = {}) {
  const listing = makeListing();
  return {
    id: 123,
    contentFingerprint: listing.contentFingerprint,
    normalizationVersion: listing.normalizationVersion,
    listingStatus: listing.listingStatus,
    listPriceEurCents: listing.listPriceEurCents,
    firstSeenAt: new Date('2026-03-20T08:00:00.000Z'),
    lastPriceChangeAt: null,
    currentScore: 72,
    title: listing.title,
    description: listing.description ?? null,
    operationType: listing.operationType,
    propertyType: listing.propertyType,
    districtNo: listing.districtNo ?? null,
    city: listing.city,
    livingAreaSqm: listing.livingAreaSqm ?? null,
    usableAreaSqm: listing.usableAreaSqm ?? null,
    rooms: listing.rooms ?? null,
    completenessScore: listing.completenessScore,
    canonicalUrl: listing.canonicalUrl,
    normalizedPayload: listing.normalizedPayload,
    propertySubtype: listing.propertySubtype ?? null,
    postalCode: listing.postalCode ?? null,
    contactName: listing.contactName ?? null,
    contactCompany: listing.contactCompany ?? null,
    contactEmail: listing.contactEmail ?? null,
    contactPhone: listing.contactPhone ?? null,
    hasBalcony: listing.hasBalcony ?? null,
    hasTerrace: listing.hasTerrace ?? null,
    hasGarden: listing.hasGarden ?? null,
    hasElevator: listing.hasElevator ?? null,
    parkingAvailable: listing.parkingAvailable ?? null,
    isFurnished: listing.isFurnished ?? null,
    ...(overrides as object),
  };
}

function makeContext(
  overrides: Partial<NormalizationContext> = {},
): NormalizationContext {
  return {
    sourceId: 1,
    sourceListingKey: 'immoscout24:abc123',
    sourceExternalId: 'abc123',
    rawListingId: 500,
    scrapeRunId: 900,
    canonicalUrl: 'https://example.com/expose/abc123',
    detailUrl: 'https://example.com/expose/abc123',
    ...overrides,
  };
}

describe('NormalizeAndUpsert lifecycle handling', () => {
  it('overrides successful normalization with explicit sold availability', async () => {
    const normalizedListing = makeListing({ listingStatus: 'active', sourceStatusRaw: 'active' });
    const normalizer: SourceNormalizer = {
      sourceCode: 'immoscout24',
      normalizationVersion: 2,
      normalize: vi.fn(
        (): NormalizationResult => ({
          success: true,
          listing: normalizedListing,
          warnings: [],
          errors: [],
          provenance: {},
          versionReason: 'first_seen',
        }),
      ),
    };

    const upsertListing = vi.fn(
      async (_input: CanonicalListingInput) => ({ id: 123, isNew: false }),
    );
    const appendListingVersion = vi.fn(async () => ({ id: 777, versionNo: 2 }));

    const sut = new NormalizeAndUpsert(new Map([['immoscout24', normalizer]]), {
      findExistingListing: vi.fn(async () => makeExistingListing()),
      upsertListing,
      updateLifecycleStatus: vi.fn(async () => ({ id: 123 })),
      appendListingVersion,
      updateScrapeRunNormalizationCounts: vi.fn(async () => {}),
    });

    const result = await sut.process(
      'immoscout24',
      {} as SourceRawListingBase,
      makeContext({ availabilityStatus: 'sold' }),
      900,
    );

    expect(result.versionReason).toBe('status_change');
    expect(result.listingVersionId).toBe(777);
    expect(upsertListing).toHaveBeenCalledTimes(1);
    expect(upsertListing.mock.calls[0]?.[0]).toMatchObject({
      listingStatus: 'sold',
      sourceStatusRaw: 'sold',
    });
    expect(upsertListing.mock.calls[0]?.[0].contentFingerprint).toBe(
      computeContentFingerprint({ ...normalizedListing, listingStatus: 'sold' }),
    );
    expect(appendListingVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        listingStatus: 'sold',
      }),
    );
  });

  it('applies withdrawn status-only update when normalization fails but not_found is explicit', async () => {
    const existing = makeExistingListing();
    const normalizer: SourceNormalizer = {
      sourceCode: 'immoscout24',
      normalizationVersion: 2,
      normalize: vi.fn(
        (): NormalizationResult => ({
          success: false,
          listing: null,
          warnings: [],
          errors: ['missing_title'],
          provenance: {},
          versionReason: null,
        }),
      ),
    };

    const updateLifecycleStatus = vi.fn(async () => ({ id: existing.id }));
    const appendListingVersion = vi.fn(async () => ({ id: 888, versionNo: 2 }));
    const upsertListing = vi.fn(async () => ({ id: existing.id, isNew: false }));

    const sut = new NormalizeAndUpsert(new Map([['immoscout24', normalizer]]), {
      findExistingListing: vi.fn(async () => existing),
      upsertListing,
      updateLifecycleStatus,
      appendListingVersion,
      updateScrapeRunNormalizationCounts: vi.fn(async () => {}),
    });

    const result = await sut.process(
      'immoscout24',
      {} as SourceRawListingBase,
      makeContext({ availabilityStatus: 'not_found' }),
      900,
    );

    expect(result.versionReason).toBe('status_change');
    expect(result.listingId).toBe(existing.id);
    expect(result.listingVersionId).toBe(888);
    expect(upsertListing).not.toHaveBeenCalled();
    expect(updateLifecycleStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        listingStatus: 'withdrawn',
        sourceStatusRaw: 'not_found',
      }),
    );
    expect(appendListingVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        listingStatus: 'withdrawn',
      }),
    );
  });
});
