import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeRiskFlags, computeUpsideFlags, type RiskFlagInput } from '../risk-flags.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeBaseInput(overrides?: Partial<RiskFlagInput>): RiskFlagInput {
  return {
    operationType: 'sale',
    propertyType: 'apartment',
    listPriceEurCents: 30_000_000,
    pricePerSqmEur: 5000,
    livingAreaSqm: 60,
    rooms: 3,
    yearBuilt: 2000,
    conditionCategory: null,
    districtNo: 1,
    geocodePrecision: 'address',
    currentScore: 50,
    completenessScore: 80,
    firstSeenAt: new Date(), // today => 0 days on market
    lastPriceChangeAt: null,
    districtMedianPpsqm: 5000,
    ...overrides,
  };
}

// ── Time control ─────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

// ── computeRiskFlags ─────────────────────────────────────────────────────

describe('computeRiskFlags', () => {
  describe('healthy data produces no flags', () => {
    it('returns empty array for healthy listing', () => {
      const flags = computeRiskFlags(makeBaseInput());
      expect(flags).toEqual([]);
    });
  });

  describe('geocode precision', () => {
    it('flags district-level geocode', () => {
      const flags = computeRiskFlags(makeBaseInput({ geocodePrecision: 'district' }));
      expect(flags).toContain('Location only approximate (district/city level)');
    });

    it('flags city-level geocode', () => {
      const flags = computeRiskFlags(makeBaseInput({ geocodePrecision: 'city' }));
      expect(flags).toContain('Location only approximate (district/city level)');
    });

    it('flags null geocode precision', () => {
      const flags = computeRiskFlags(makeBaseInput({ geocodePrecision: null }));
      expect(flags).toContain('No geocoded location — spatial analysis unavailable');
    });

    it('flags "none" geocode precision', () => {
      const flags = computeRiskFlags(makeBaseInput({ geocodePrecision: 'none' }));
      expect(flags).toContain('No geocoded location — spatial analysis unavailable');
    });

    it('does not flag address-level geocode', () => {
      const flags = computeRiskFlags(makeBaseInput({ geocodePrecision: 'address' }));
      expect(flags).not.toContain('Location only approximate (district/city level)');
      expect(flags).not.toContain('No geocoded location — spatial analysis unavailable');
    });
  });

  describe('completeness score', () => {
    it('flags completeness below 50', () => {
      const flags = computeRiskFlags(makeBaseInput({ completenessScore: 49 }));
      expect(flags).toContain('Low data completeness — key fields may be missing');
    });

    it('does not flag completeness at 50', () => {
      const flags = computeRiskFlags(makeBaseInput({ completenessScore: 50 }));
      expect(flags).not.toContain('Low data completeness — key fields may be missing');
    });
  });

  describe('price premium', () => {
    it('flags price > 30% above district median', () => {
      const flags = computeRiskFlags(
        makeBaseInput({ pricePerSqmEur: 7000, districtMedianPpsqm: 5000 }),
      );
      // (7000 - 5000) / 5000 * 100 = 40%
      expect(flags).toContain('Price/sqm 40% above district median');
    });

    it('does not flag price exactly 30% above median', () => {
      const flags = computeRiskFlags(
        makeBaseInput({ pricePerSqmEur: 6500, districtMedianPpsqm: 5000 }),
      );
      // (6500 - 5000) / 5000 * 100 = 30% exactly
      expect(flags.find((f) => f.includes('above district median'))).toBeUndefined();
    });

    it('does not flag when pricePerSqmEur is null', () => {
      const flags = computeRiskFlags(
        makeBaseInput({ pricePerSqmEur: null, districtMedianPpsqm: 5000 }),
      );
      expect(flags.find((f) => f.includes('above district median'))).toBeUndefined();
    });

    it('does not flag when districtMedianPpsqm is null', () => {
      const flags = computeRiskFlags(
        makeBaseInput({ pricePerSqmEur: 7000, districtMedianPpsqm: null }),
      );
      expect(flags.find((f) => f.includes('above district median'))).toBeUndefined();
    });
  });

  describe('building age', () => {
    it('flags year built before 1960', () => {
      const flags = computeRiskFlags(makeBaseInput({ yearBuilt: 1959 }));
      expect(flags).toContain('Pre-1960 building — may have renovation needs');
    });

    it('does not flag year built 1960', () => {
      const flags = computeRiskFlags(makeBaseInput({ yearBuilt: 1960 }));
      expect(flags).not.toContain('Pre-1960 building — may have renovation needs');
    });

    it('does not flag null yearBuilt', () => {
      const flags = computeRiskFlags(makeBaseInput({ yearBuilt: null }));
      expect(flags).not.toContain('Pre-1960 building — may have renovation needs');
    });
  });

  describe('time on market', () => {
    it('flags listings older than 90 days', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01'));

      const firstSeen = new Date('2026-02-01'); // ~120 days
      const flags = computeRiskFlags(makeBaseInput({ firstSeenAt: firstSeen }));

      expect(flags.find((f) => f.includes('extended time on market'))).toBeDefined();
    });

    it('does not flag listings at exactly 90 days', () => {
      vi.useFakeTimers();
      const now = new Date('2026-06-01');
      vi.setSystemTime(now);

      const firstSeen = new Date('2026-03-03'); // 90 days
      const flags = computeRiskFlags(makeBaseInput({ firstSeenAt: firstSeen }));

      expect(flags.find((f) => f.includes('extended time on market'))).toBeUndefined();
    });
  });

  describe('missing data', () => {
    it('flags missing living area', () => {
      const flags = computeRiskFlags(makeBaseInput({ livingAreaSqm: null }));
      expect(flags).toContain('Living area not specified');
    });

    it('flags missing rooms', () => {
      const flags = computeRiskFlags(makeBaseInput({ rooms: null }));
      expect(flags).toContain('Room count not specified');
    });
  });

  describe('legal rent status', () => {
    it('flags likely_capped status', () => {
      const flags = computeRiskFlags(makeBaseInput({ legalRentStatus: 'likely_capped' }));
      expect(flags).toContain('Likely subject to rent regulation (MRG)');
    });

    it('flags likely_capped_missing_critical_proof status', () => {
      const flags = computeRiskFlags(
        makeBaseInput({ legalRentStatus: 'likely_capped_missing_critical_proof' }),
      );
      expect(flags).toContain('May be rent-regulated — critical facts unverified');
    });

    it('does not flag other legal rent statuses', () => {
      const flags = computeRiskFlags(makeBaseInput({ legalRentStatus: 'free_market' }));
      expect(
        flags.find((f) => f.includes('rent regulation') || f.includes('rent-regulated')),
      ).toBeUndefined();
    });
  });

  describe('thin comparable set', () => {
    it('flags sale comp sample size between 1 and 2', () => {
      const flags = computeRiskFlags(makeBaseInput({ saleCompSampleSize: 2 }));
      expect(flags).toContain('Thin comparable set — market context uncertain');
    });

    it('flags sale comp sample size of 1', () => {
      const flags = computeRiskFlags(makeBaseInput({ saleCompSampleSize: 1 }));
      expect(flags).toContain('Thin comparable set — market context uncertain');
    });

    it('does not flag sale comp sample size of 0', () => {
      const flags = computeRiskFlags(makeBaseInput({ saleCompSampleSize: 0 }));
      expect(flags).not.toContain('Thin comparable set — market context uncertain');
    });

    it('does not flag sale comp sample size of 3 or more', () => {
      const flags = computeRiskFlags(makeBaseInput({ saleCompSampleSize: 3 }));
      expect(flags).not.toContain('Thin comparable set — market context uncertain');
    });

    it('does not flag when saleCompSampleSize is undefined', () => {
      const flags = computeRiskFlags(makeBaseInput());
      expect(flags).not.toContain('Thin comparable set — market context uncertain');
    });
  });
});

// ── computeUpsideFlags ───────────────────────────────────────────────────

describe('computeUpsideFlags', () => {
  describe('healthy data with no upside signals', () => {
    it('returns empty array for average listing', () => {
      const flags = computeUpsideFlags(makeBaseInput());
      expect(flags).toEqual([]);
    });
  });

  describe('below-market pricing', () => {
    it('flags price > 15% below district median', () => {
      const flags = computeUpsideFlags(
        makeBaseInput({ pricePerSqmEur: 4000, districtMedianPpsqm: 5000 }),
      );
      // (5000 - 4000) / 5000 * 100 = 20%
      expect(flags).toContain('Price/sqm 20% below district median');
    });

    it('does not flag price exactly 15% below median', () => {
      const flags = computeUpsideFlags(
        makeBaseInput({ pricePerSqmEur: 4250, districtMedianPpsqm: 5000 }),
      );
      // (5000 - 4250) / 5000 * 100 = 15% exactly
      expect(flags.find((f) => f.includes('below district median'))).toBeUndefined();
    });

    it('does not flag when either price value is null', () => {
      const flags1 = computeUpsideFlags(
        makeBaseInput({ pricePerSqmEur: null, districtMedianPpsqm: 5000 }),
      );
      const flags2 = computeUpsideFlags(
        makeBaseInput({ pricePerSqmEur: 3000, districtMedianPpsqm: null }),
      );
      expect(flags1.find((f) => f.includes('below district median'))).toBeUndefined();
      expect(flags2.find((f) => f.includes('below district median'))).toBeUndefined();
    });
  });

  describe('high score', () => {
    it('flags score >= 80', () => {
      const flags = computeUpsideFlags(makeBaseInput({ currentScore: 80 }));
      expect(flags).toContain('High intelligence score (80+)');
    });

    it('flags score above 80', () => {
      const flags = computeUpsideFlags(makeBaseInput({ currentScore: 95 }));
      expect(flags).toContain('High intelligence score (80+)');
    });

    it('does not flag score below 80', () => {
      const flags = computeUpsideFlags(makeBaseInput({ currentScore: 79 }));
      expect(flags).not.toContain('High intelligence score (80+)');
    });

    it('does not flag null score', () => {
      const flags = computeUpsideFlags(makeBaseInput({ currentScore: null }));
      expect(flags).not.toContain('High intelligence score (80+)');
    });
  });

  describe('recent price change', () => {
    it('flags price change within last 14 days', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-20'));

      const flags = computeUpsideFlags(
        makeBaseInput({ lastPriceChangeAt: new Date('2026-03-10') }),
      );
      expect(flags).toContain('Recent price change (last 14 days)');
    });

    it('does not flag price change older than 14 days', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-20'));

      const flags = computeUpsideFlags(
        makeBaseInput({ lastPriceChangeAt: new Date('2026-03-01') }),
      );
      expect(flags).not.toContain('Recent price change (last 14 days)');
    });

    it('does not flag null lastPriceChangeAt', () => {
      const flags = computeUpsideFlags(makeBaseInput({ lastPriceChangeAt: null }));
      expect(flags).not.toContain('Recent price change (last 14 days)');
    });
  });

  describe('data completeness', () => {
    it('flags completeness >= 90', () => {
      const flags = computeUpsideFlags(makeBaseInput({ completenessScore: 90 }));
      expect(flags).toContain('High data completeness (90%+)');
    });

    it('does not flag completeness below 90', () => {
      const flags = computeUpsideFlags(makeBaseInput({ completenessScore: 89 }));
      expect(flags).not.toContain('High data completeness (90%+)');
    });
  });

  describe('outdoor space', () => {
    it('flags balcony', () => {
      const flags = computeUpsideFlags(makeBaseInput({ hasBalcony: true }));
      expect(flags).toContain('Has outdoor space (balcony)');
    });

    it('flags terrace', () => {
      const flags = computeUpsideFlags(makeBaseInput({ hasTerrace: true }));
      expect(flags).toContain('Has outdoor space (terrace)');
    });

    it('flags garden', () => {
      const flags = computeUpsideFlags(makeBaseInput({ hasGarden: true }));
      expect(flags).toContain('Has outdoor space (garden)');
    });

    it('combines multiple outdoor spaces', () => {
      const flags = computeUpsideFlags(
        makeBaseInput({ hasBalcony: true, hasTerrace: true, hasGarden: true }),
      );
      expect(flags).toContain('Has outdoor space (balcony, terrace, garden)');
    });

    it('does not flag when all outdoor spaces are false or null', () => {
      const flags = computeUpsideFlags(
        makeBaseInput({ hasBalcony: false, hasTerrace: null, hasGarden: undefined }),
      );
      expect(flags.find((f) => f.includes('outdoor space'))).toBeUndefined();
    });
  });

  describe('transit access', () => {
    it('flags transit distance < 300m', () => {
      const flags = computeUpsideFlags(makeBaseInput({ nearestTransitDistanceM: 150 }));
      expect(flags).toContain('Excellent transit access (< 300m)');
    });

    it('does not flag transit distance >= 300m', () => {
      const flags = computeUpsideFlags(makeBaseInput({ nearestTransitDistanceM: 300 }));
      expect(flags).not.toContain('Excellent transit access (< 300m)');
    });

    it('does not flag null transit distance', () => {
      const flags = computeUpsideFlags(makeBaseInput({ nearestTransitDistanceM: null }));
      expect(flags).not.toContain('Excellent transit access (< 300m)');
    });
  });

  describe('condition', () => {
    it.each([
      'gut',
      'Gut',
      'good',
      'Good',
      'excellent',
      'Excellent',
      'renoviert',
      'Renoviert',
      'renovated',
      'saniert',
    ])('flags condition "%s" as good', (condition) => {
      const flags = computeUpsideFlags(makeBaseInput({ conditionCategory: condition }));
      expect(flags).toContain('Good reported condition');
    });

    it('does not flag poor condition', () => {
      const flags = computeUpsideFlags(makeBaseInput({ conditionCategory: 'poor' }));
      expect(flags).not.toContain('Good reported condition');
    });

    it('does not flag null condition', () => {
      const flags = computeUpsideFlags(makeBaseInput({ conditionCategory: null }));
      expect(flags).not.toContain('Good reported condition');
    });
  });
});
