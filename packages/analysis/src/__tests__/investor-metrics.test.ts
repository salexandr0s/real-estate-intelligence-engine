import { describe, it, expect } from 'vitest';
import type { MarketRentEstimate } from '@immoradar/contracts';
import { computeInvestorMetrics } from '../investor-metrics.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeRentEstimate(overrides?: Partial<MarketRentEstimate>): MarketRentEstimate {
  return {
    estimateLow: 600,
    estimateMid: 800,
    estimateHigh: 1000,
    eurPerSqmMid: 12,
    fallbackLevel: 'nearby',
    sampleSize: 10,
    confidence: 'high',
    ...overrides,
  };
}

// ── computeInvestorMetrics ───────────────────────────────────────────────

describe('computeInvestorMetrics', () => {
  describe('null / invalid inputs', () => {
    it('returns null when listPriceEurCents is null', () => {
      const result = computeInvestorMetrics(null, makeRentEstimate());
      expect(result).toBeNull();
    });

    it('returns null when listPriceEurCents is zero', () => {
      const result = computeInvestorMetrics(0, makeRentEstimate());
      expect(result).toBeNull();
    });

    it('returns null when listPriceEurCents is negative', () => {
      const result = computeInvestorMetrics(-100, makeRentEstimate());
      expect(result).toBeNull();
    });

    it('returns null when marketRent is null', () => {
      const result = computeInvestorMetrics(30_000_000, null);
      expect(result).toBeNull();
    });

    it('returns null when estimateMid is null', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ estimateMid: null }));
      expect(result).toBeNull();
    });

    it('returns null when estimateMid is zero', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ estimateMid: 0 }));
      expect(result).toBeNull();
    });
  });

  describe('valid computation', () => {
    it('computes gross yield correctly', () => {
      // Purchase price: 30_000_000 cents = 300_000 EUR
      // Monthly rent mid: 800 EUR => annual = 9600
      // Gross yield = (9600 / 300_000) * 100 = 3.2%
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate());

      expect(result).not.toBeNull();
      expect(result!.grossYield.value).toBe(3.2);
    });

    it('computes price-to-rent correctly', () => {
      // Purchase price: 300_000 EUR, annual rent: 9600
      // price-to-rent = 300_000 / 9600 = 31.25 => rounded to 31.3 (1 decimal)
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate());

      expect(result).not.toBeNull();
      expect(result!.priceToRent).toBe(31.3);
    });

    it('computes sensitivity bands from low/mid/high', () => {
      // Purchase price: 300_000 EUR
      // Low rent: 600/mo => 7200/yr => yield = (7200/300_000)*100 = 2.4%
      // Base rent: 800/mo => 9600/yr => yield = 3.2%
      // High rent: 1000/mo => 12000/yr => yield = (12000/300_000)*100 = 4.0%
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate());

      expect(result).not.toBeNull();
      expect(result!.sensitivityBands.low).toBe(2.4);
      expect(result!.sensitivityBands.base).toBe(3.2);
      expect(result!.sensitivityBands.high).toBe(4);
    });

    it('returns null sensitivity low when estimateLow is null', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ estimateLow: null }));

      expect(result).not.toBeNull();
      expect(result!.sensitivityBands.low).toBeNull();
      expect(result!.sensitivityBands.base).toBe(3.2);
    });

    it('returns null sensitivity low when estimateLow is zero', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ estimateLow: 0 }));

      expect(result).not.toBeNull();
      expect(result!.sensitivityBands.low).toBeNull();
    });

    it('returns null sensitivity high when estimateHigh is null', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ estimateHigh: null }));

      expect(result).not.toBeNull();
      expect(result!.sensitivityBands.high).toBeNull();
      expect(result!.sensitivityBands.base).toBe(3.2);
    });
  });

  describe('assumptions', () => {
    it('includes base assumptions', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate());

      expect(result).not.toBeNull();
      expect(result!.grossYield.assumptions).toContain(
        'Gross yield assumes 12 months full occupancy',
      );
      expect(result!.grossYield.assumptions).toContain(
        'No transaction costs, taxes, or operating expenses deducted',
      );
    });

    it('includes confidence level in assumptions', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ confidence: 'low' }));

      expect(result).not.toBeNull();
      expect(result!.grossYield.assumptions).toContain('Market rent estimate confidence: low');
    });

    it('adds fallback note when not nearby', () => {
      const result = computeInvestorMetrics(
        30_000_000,
        makeRentEstimate({ fallbackLevel: 'district' }),
      );

      expect(result).not.toBeNull();
      expect(result!.grossYield.assumptions).toContain(
        'Rent estimate uses district-level comparables (less precise)',
      );
    });

    it('does not add fallback note when nearby', () => {
      const result = computeInvestorMetrics(
        30_000_000,
        makeRentEstimate({ fallbackLevel: 'nearby' }),
      );

      expect(result).not.toBeNull();
      const fallbackAssumptions = result!.grossYield.assumptions.filter((a) =>
        a.includes('level comparables'),
      );
      expect(fallbackAssumptions).toHaveLength(0);
    });

    it('adds thin sample note when sampleSize < 5', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ sampleSize: 3 }));

      expect(result).not.toBeNull();
      expect(result!.grossYield.assumptions).toContain('Based on 3 comparables (thin sample)');
    });

    it('uses singular "comparable" for sampleSize 1', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ sampleSize: 1 }));

      expect(result).not.toBeNull();
      expect(result!.grossYield.assumptions).toContain('Based on 1 comparable (thin sample)');
    });

    it('does not add thin sample note when sampleSize >= 5', () => {
      const result = computeInvestorMetrics(30_000_000, makeRentEstimate({ sampleSize: 5 }));

      expect(result).not.toBeNull();
      const thinSampleNotes = result!.grossYield.assumptions.filter((a) =>
        a.includes('thin sample'),
      );
      expect(thinSampleNotes).toHaveLength(0);
    });
  });

  describe('rounding', () => {
    it('rounds gross yield to 2 decimal places', () => {
      // 200_000 EUR purchase, 750/mo rent => annual 9000
      // yield = (9000/200_000)*100 = 4.5 exactly
      const result = computeInvestorMetrics(20_000_000, makeRentEstimate({ estimateMid: 750 }));

      expect(result).not.toBeNull();
      expect(result!.grossYield.value).toBe(4.5);
    });

    it('rounds price-to-rent to 1 decimal place', () => {
      // 200_000 EUR purchase, 750/mo => annual 9000
      // price-to-rent = 200_000/9000 = 22.222... => 22.2
      const result = computeInvestorMetrics(20_000_000, makeRentEstimate({ estimateMid: 750 }));

      expect(result).not.toBeNull();
      expect(result!.priceToRent).toBe(22.2);
    });
  });
});
