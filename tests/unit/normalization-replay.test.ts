import { describe, it, expect } from 'vitest';
import { BaseSourceMapper } from '@rei/normalization';

describe('normalization replay', () => {
  const mapper = new BaseSourceMapper('test');

  const rawPayload = {
    titleRaw: 'Schöne 3-Zimmer Wohnung in Leopoldstadt',
    descriptionRaw: 'Helle Wohnung mit Balkon, frisch renoviert.',
    operationTypeRaw: 'kaufen',
    propertyTypeRaw: 'Eigentumswohnung',
    priceRaw: '€ 299.000',
    livingAreaRaw: '72,5 m²',
    roomsRaw: '3',
    postalCodeRaw: '1020',
    cityRaw: 'Wien',
    streetRaw: 'Taborstraße',
    houseNumberRaw: '42',
    statusRaw: 'active',
  };

  const context = {
    sourceId: 1,
    sourceListingKey: 'test-replay-001',
    sourceExternalId: null,
    rawListingId: 1,
    scrapeRunId: 1,
    canonicalUrl: 'https://example.com/listing/001',
    detailUrl: 'https://example.com/listing/001',
  };

  it('produces identical output on repeated normalization', () => {
    const result1 = mapper.normalize(rawPayload, context);
    const result2 = mapper.normalize(rawPayload, context);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    if (!result1.success || !result2.success) return;

    // Content fingerprints must match
    expect(result1.listing.contentFingerprint).toBe(result2.listing.contentFingerprint);

    // Completeness scores must match
    expect(result1.listing.completenessScore).toBe(result2.listing.completenessScore);

    // Key fields must match
    expect(result1.listing.listPriceEurCents).toBe(result2.listing.listPriceEurCents);
    expect(result1.listing.livingAreaSqm).toBe(result2.listing.livingAreaSqm);
    expect(result1.listing.rooms).toBe(result2.listing.rooms);
    expect(result1.listing.districtNo).toBe(result2.listing.districtNo);
    expect(result1.listing.title).toBe(result2.listing.title);
    expect(result1.listing.operationType).toBe(result2.listing.operationType);
    expect(result1.listing.propertyType).toBe(result2.listing.propertyType);
  });

  it('produces same fingerprint regardless of call order', () => {
    const resultA = mapper.normalize(rawPayload, context);
    // Normalize a different payload to "reset" any state
    mapper.normalize({ ...rawPayload, titleRaw: 'Different' }, context);
    const resultB = mapper.normalize(rawPayload, context);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    if (resultA.success && resultB.success) {
      expect(resultA.listing.contentFingerprint).toBe(resultB.listing.contentFingerprint);
    }
  });
});
