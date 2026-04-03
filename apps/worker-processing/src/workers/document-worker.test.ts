import { describe, expect, it } from 'vitest';
import type { ListingRow, SourceRow } from '@immoradar/contracts';
import { buildAllowedDocumentHosts, isAcceptedDocumentContentType } from './document-worker.js';

function makeListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 1,
    listingUid: 'listing-uid',
    sourceId: 1,
    sourceCode: 'willhaben',
    sourceListingKey: 'source-key',
    sourceExternalId: null,
    currentRawListingId: 1,
    latestScrapeRunId: 1,
    canonicalUrl: 'https://www.example.com/listing/123',
    operationType: 'sale',
    propertyType: 'apartment',
    propertySubtype: null,
    listingStatus: 'active',
    sourceStatusRaw: null,
    title: 'Listing',
    description: null,
    districtNo: null,
    districtName: null,
    postalCode: null,
    city: 'Vienna',
    federalState: null,
    street: null,
    houseNumber: null,
    addressDisplay: null,
    latitude: null,
    longitude: null,
    geocodePrecision: null,
    geocodeSource: null,
    geocodeUpdatedAt: null,
    crossSourceFingerprint: null,
    listPriceEurCents: null,
    monthlyOperatingCostEurCents: null,
    reserveFundEurCents: null,
    commissionEurCents: null,
    livingAreaSqm: null,
    usableAreaSqm: null,
    balconyAreaSqm: null,
    terraceAreaSqm: null,
    gardenAreaSqm: null,
    rooms: null,
    floorLabel: null,
    floorNumber: null,
    yearBuilt: null,
    conditionCategory: null,
    heatingType: null,
    energyCertificateClass: null,
    contactName: null,
    contactCompany: null,
    contactEmail: null,
    contactPhone: null,
    hasBalcony: null,
    hasTerrace: null,
    hasGarden: null,
    hasElevator: null,
    parkingAvailable: null,
    isFurnished: null,
    pricePerSqmEur: null,
    completenessScore: 0,
    currentScore: null,
    normalizationVersion: 1,
    contentFingerprint: 'fingerprint',
    normalizedPayload: {},
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    firstPublishedAt: null,
    lastPriceChangeAt: null,
    lastContentChangeAt: null,
    lastStatusChangeAt: null,
    lastScoredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSource(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 1,
    code: 'willhaben',
    name: 'Willhaben',
    baseUrl: 'https://www.example.com',
    countryCode: 'AT',
    scrapeMode: 'browser',
    isActive: true,
    healthStatus: 'healthy',
    crawlIntervalMinutes: 30,
    priority: 100,
    rateLimitRpm: 12,
    concurrencyLimit: 1,
    parserVersion: 1,
    legalStatus: 'review_required',
    config: {},
    lastSuccessfulRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildAllowedDocumentHosts', () => {
  it('includes the canonical host, source base URL host, and allowlisted document hosts', () => {
    const listing = makeListing({
      canonicalUrl: 'https://www.example.com/listing/123',
    });
    const source = makeSource({
      baseUrl: 'https://example.com',
      config: {
        documentHostAllowlist: ['cdn.example.com', 'docs.example.net'],
      },
    });

    expect(buildAllowedDocumentHosts(listing, source)).toEqual([
      'www.example.com',
      'example.com',
      'cdn.example.com',
      'docs.example.net',
    ]);
  });
});

describe('isAcceptedDocumentContentType', () => {
  it('accepts PDFs by mime type', () => {
    expect(isAcceptedDocumentContentType('application/pdf', 'https://example.com/doc')).toBe(true);
  });

  it('accepts images by mime type', () => {
    expect(isAcceptedDocumentContentType('image/png', 'https://example.com/doc')).toBe(true);
  });

  it('accepts missing mime type only for PDF URLs', () => {
    expect(isAcceptedDocumentContentType(null, 'https://example.com/doc.pdf')).toBe(true);
    expect(isAcceptedDocumentContentType(null, 'https://example.com/doc.jpg')).toBe(false);
  });

  it('rejects unsupported content types', () => {
    expect(isAcceptedDocumentContentType('text/html', 'https://example.com/doc')).toBe(false);
  });
});
