import { describe, it, expect } from 'vitest';
import type { ComparableEntry } from '@rei/contracts';
import { estimateMarketRent, deriveConfidence } from '../market-rent.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeComp(
  pricePerSqmEur: number | null,
  overrides?: Partial<ComparableEntry>,
): ComparableEntry {
  return {
    listingId: 1,
    title: 'Test Listing',
    districtNo: 1,
    operationType: 'rent',
    propertyType: 'apartment',
    listPriceEurCents: pricePerSqmEur != null ? pricePerSqmEur * 50 * 100 : null,
    pricePerSqmEur,
    livingAreaSqm: 50,
    rooms: 2,
    distanceM: 100,
    firstSeenAt: new Date('2026-01-01'),
    canonicalUrl: 'https://example.com/listing',
    ...overrides,
  };
}

// ── estimateMarketRent ───────────────────────────────────────────────────

describe('estimateMarketRent', () => {
  describe('null / empty inputs', () => {
    it('returns null estimates when comps array is empty', () => {
      const result = estimateMarketRent([], 60, 'nearby');

      expect(result.estimateLow).toBeNull();
      expect(result.estimateMid).toBeNull();
      expect(result.estimateHigh).toBeNull();
      expect(result.eurPerSqmMid).toBeNull();
      expect(result.sampleSize).toBe(0);
      expect(result.confidence).toBe('low');
      expect(result.fallbackLevel).toBe('nearby');
    });

    it('returns null estimates when targetAreaSqm is null', () => {
      const result = estimateMarketRent([makeComp(12)], null, 'nearby');

      expect(result.estimateLow).toBeNull();
      expect(result.estimateMid).toBeNull();
      expect(result.estimateHigh).toBeNull();
      expect(result.sampleSize).toBe(0);
    });

    it('returns null estimates when targetAreaSqm is zero', () => {
      const result = estimateMarketRent([makeComp(12)], 0, 'nearby');

      expect(result.estimateMid).toBeNull();
      expect(result.sampleSize).toBe(0);
    });

    it('returns null estimates when targetAreaSqm is negative', () => {
      const result = estimateMarketRent([makeComp(12)], -10, 'nearby');

      expect(result.estimateMid).toBeNull();
      expect(result.sampleSize).toBe(0);
    });

    it('filters out comps with null pricePerSqmEur', () => {
      const comps = [makeComp(null), makeComp(null), makeComp(null)];
      const result = estimateMarketRent(comps, 60, 'nearby');

      expect(result.estimateMid).toBeNull();
      expect(result.sampleSize).toBe(0);
    });

    it('filters out comps with zero pricePerSqmEur', () => {
      const comps = [makeComp(0), makeComp(0)];
      const result = estimateMarketRent(comps, 60, 'nearby');

      expect(result.estimateMid).toBeNull();
      expect(result.sampleSize).toBe(0);
    });
  });

  describe('single comp', () => {
    it('uses the single value for low/mid/high', () => {
      const comps = [makeComp(15)];
      const result = estimateMarketRent(comps, 60, 'nearby');

      // With a single comp: median = 15, p25 = 15, p75 = 15
      expect(result.estimateMid).toBe(Math.round(15 * 60));
      expect(result.estimateLow).toBe(Math.round(15 * 60));
      expect(result.estimateHigh).toBe(Math.round(15 * 60));
      expect(result.eurPerSqmMid).toBe(15);
      expect(result.sampleSize).toBe(1);
    });
  });

  describe('small sample (< 5, no trimming)', () => {
    it('computes correct median and percentiles for 3 comps', () => {
      const comps = [makeComp(10), makeComp(14), makeComp(18)];
      const result = estimateMarketRent(comps, 50, 'nearby');

      // Sorted: [10, 14, 18], no trimming (< 5)
      // Median of 3 = 14
      // p25: idx = (3-1)*0.25 = 0.5 => 10*(0.5) + 14*(0.5) = 12
      // p75: idx = (3-1)*0.75 = 1.5 => 14*(0.5) + 18*(0.5) = 16
      expect(result.estimateMid).toBe(Math.round(14 * 50));
      expect(result.estimateLow).toBe(Math.round(12 * 50));
      expect(result.estimateHigh).toBe(Math.round(16 * 50));
      expect(result.eurPerSqmMid).toBe(14);
      expect(result.sampleSize).toBe(3);
    });

    it('computes correct median for even-count sample (4 comps)', () => {
      const comps = [makeComp(10), makeComp(12), makeComp(14), makeComp(16)];
      const result = estimateMarketRent(comps, 100, 'district');

      // Sorted: [10, 12, 14, 16], no trimming (< 5)
      // Median of 4: (12 + 14) / 2 = 13
      expect(result.estimateMid).toBe(Math.round(13 * 100));
      expect(result.eurPerSqmMid).toBe(13);
    });
  });

  describe('5+ comps with trimming', () => {
    it('trims top and bottom 10% for 10 comps', () => {
      // 10 values: [2, 5, 8, 10, 12, 14, 16, 18, 21, 50]
      // trim 10% = floor(10 * 0.1) = 1 from each side
      // trimmed = [5, 8, 10, 12, 14, 16, 18, 21]
      const values = [2, 5, 8, 10, 12, 14, 16, 18, 21, 50];
      const comps = values.map((v) => makeComp(v));
      const result = estimateMarketRent(comps, 40, 'nearby');

      // Trimmed: [5, 8, 10, 12, 14, 16, 18, 21]
      // Median of 8: (12 + 14) / 2 = 13
      expect(result.estimateMid).toBe(Math.round(13 * 40));
      expect(result.eurPerSqmMid).toBe(13);
      expect(result.sampleSize).toBe(10);
    });

    it('trims correctly for exactly 5 comps', () => {
      // 5 values: [1, 5, 10, 15, 100]
      // trim 10% = floor(5 * 0.1) = 0 from each side (no trim)
      const values = [1, 5, 10, 15, 100];
      const comps = values.map((v) => makeComp(v));
      const result = estimateMarketRent(comps, 50, 'nearby');

      // No actual trim since floor(5 * 0.1) = 0
      // Median of 5 = 10 (index 2)
      expect(result.estimateMid).toBe(Math.round(10 * 50));
      expect(result.sampleSize).toBe(5);
    });

    it('trims correctly for 20 comps', () => {
      // 20 comps: trim floor(20*0.1) = 2 from each side
      const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
      // [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]
      // trimmed (remove 2 from each side): [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]
      // 16 items, median = (50 + 55) / 2 = 52.5
      const comps = values.map((v) => makeComp(v));
      const result = estimateMarketRent(comps, 80, 'nearby');

      expect(result.estimateMid).toBe(Math.round(52.5 * 80));
      expect(result.eurPerSqmMid).toBe(52.5);
      expect(result.sampleSize).toBe(20);
    });
  });

  describe('mixed valid and invalid comps', () => {
    it('only counts valid comps for sampleSize', () => {
      const comps = [makeComp(10), makeComp(null), makeComp(14), makeComp(0), makeComp(18)];
      const result = estimateMarketRent(comps, 50, 'nearby');

      // Valid: [10, 14, 18], sampleSize = 3
      expect(result.sampleSize).toBe(3);
      expect(result.estimateMid).toBe(Math.round(14 * 50));
    });
  });

  describe('fallbackLevel passthrough', () => {
    it('preserves the fallback level in the result', () => {
      const comps = [makeComp(12)];

      expect(estimateMarketRent(comps, 50, 'nearby').fallbackLevel).toBe('nearby');
      expect(estimateMarketRent(comps, 50, 'district').fallbackLevel).toBe('district');
      expect(estimateMarketRent(comps, 50, 'city').fallbackLevel).toBe('city');
    });
  });

  describe('eurPerSqmMid rounding', () => {
    it('rounds eurPerSqmMid to 2 decimal places', () => {
      // Two comps: [10, 11] => median = 10.5 => rounded to 10.5 (already 1 decimal)
      const comps = [makeComp(10), makeComp(11)];
      const result = estimateMarketRent(comps, 50, 'nearby');

      expect(result.eurPerSqmMid).toBe(10.5);
    });
  });
});

// ── deriveConfidence ─────────────────────────────────────────────────────

describe('deriveConfidence', () => {
  it('returns high when nearby and sampleSize >= 5', () => {
    expect(deriveConfidence(5, 'nearby')).toBe('high');
    expect(deriveConfidence(100, 'nearby')).toBe('high');
  });

  it('returns medium when nearby and sampleSize >= 2 but < 5', () => {
    expect(deriveConfidence(2, 'nearby')).toBe('medium');
    expect(deriveConfidence(3, 'nearby')).toBe('medium');
    expect(deriveConfidence(4, 'nearby')).toBe('medium');
  });

  it('returns low when nearby and sampleSize < 2', () => {
    expect(deriveConfidence(0, 'nearby')).toBe('low');
    expect(deriveConfidence(1, 'nearby')).toBe('low');
  });

  it('returns medium when district and sampleSize >= 10', () => {
    expect(deriveConfidence(10, 'district')).toBe('medium');
    expect(deriveConfidence(50, 'district')).toBe('medium');
  });

  it('returns low when district and sampleSize < 10', () => {
    expect(deriveConfidence(0, 'district')).toBe('low');
    expect(deriveConfidence(5, 'district')).toBe('low');
    expect(deriveConfidence(9, 'district')).toBe('low');
  });

  it('returns low for city fallback regardless of sample size', () => {
    expect(deriveConfidence(0, 'city')).toBe('low');
    expect(deriveConfidence(5, 'city')).toBe('low');
    expect(deriveConfidence(100, 'city')).toBe('low');
  });
});
