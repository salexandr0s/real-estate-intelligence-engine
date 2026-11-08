import { describe, expect, it } from 'vitest';
import { computeCrossSourceFingerprint } from './fingerprint.js';

describe('computeCrossSourceFingerprint', () => {
  // Same district, size and price: without a street, nothing tells two such listings apart.
  const district = {
    postalCode: '1020',
    city: 'Wien',
    livingAreaSqm: 72,
    listPriceEurCents: 29_900_000,
  };

  it('returns null without a street, so listings that share only a district never cluster', () => {
    expect(computeCrossSourceFingerprint(district)).toBeNull();
    expect(computeCrossSourceFingerprint({ ...district, street: '   ' })).toBeNull();
    expect(computeCrossSourceFingerprint({ ...district, street: 'Taborstraße' })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
