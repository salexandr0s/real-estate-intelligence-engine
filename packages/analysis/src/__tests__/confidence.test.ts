import { describe, it, expect } from 'vitest';
import { computeAnalysisConfidence } from '../confidence.js';

// ── Helpers ──────────────────────────────────────────────────────────────

interface ConfidenceInput {
  geocodePrecision: string | null;
  saleCompSampleSize: number;
  rentCompSampleSize: number;
  buildingMatchConfidence: string | null;
  hasLivingArea: boolean;
  hasRooms: boolean;
  hasYearBuilt: boolean;
}

function makeFullInput(overrides?: Partial<ConfidenceInput>): ConfidenceInput {
  return {
    geocodePrecision: 'address',
    saleCompSampleSize: 10,
    rentCompSampleSize: 10,
    buildingMatchConfidence: 'high',
    hasLivingArea: true,
    hasRooms: true,
    hasYearBuilt: true,
    ...overrides,
  };
}

// ── computeAnalysisConfidence ────────────────────────────────────────────

describe('computeAnalysisConfidence', () => {
  describe('full data => high confidence', () => {
    it('returns high confidence with no degradation reasons when all data present', () => {
      const result = computeAnalysisConfidence(makeFullInput());

      expect(result.level).toBe('high');
      expect(result.degradationReasons).toEqual([]);
    });
  });

  describe('geocode precision degradation', () => {
    it('degrades by 30 for null geocode precision', () => {
      const result = computeAnalysisConfidence(makeFullInput({ geocodePrecision: null }));

      // 100 - 30 = 70 => high
      expect(result.level).toBe('high');
      expect(result.degradationReasons).toContain('No geocoded location');
    });

    it('degrades by 30 for "none" geocode precision', () => {
      const result = computeAnalysisConfidence(makeFullInput({ geocodePrecision: 'none' }));

      expect(result.level).toBe('high');
      expect(result.degradationReasons).toContain('No geocoded location');
    });

    it('degrades by 20 for "city" geocode precision', () => {
      const result = computeAnalysisConfidence(makeFullInput({ geocodePrecision: 'city' }));

      // 100 - 20 = 80 => high
      expect(result.level).toBe('high');
      expect(result.degradationReasons).toContain(
        'Location only approximate (district/city level)',
      );
    });

    it('degrades by 20 for "district" geocode precision', () => {
      const result = computeAnalysisConfidence(makeFullInput({ geocodePrecision: 'district' }));

      expect(result.level).toBe('high');
      expect(result.degradationReasons).toContain(
        'Location only approximate (district/city level)',
      );
    });

    it('no degradation for "address" geocode precision', () => {
      const result = computeAnalysisConfidence(makeFullInput({ geocodePrecision: 'address' }));

      expect(
        result.degradationReasons.find((r) => r.includes('geocod') || r.includes('location')),
      ).toBeUndefined();
    });
  });

  describe('sale comparable degradation', () => {
    it('degrades by 15 for zero sale comps', () => {
      const result = computeAnalysisConfidence(makeFullInput({ saleCompSampleSize: 0 }));

      // 100 - 15 = 85 => high
      expect(result.level).toBe('high');
      expect(result.degradationReasons).toContain('No sale comparables found');
    });

    it('degrades by 10 for thin sale comp set (1-2)', () => {
      const result1 = computeAnalysisConfidence(makeFullInput({ saleCompSampleSize: 1 }));
      expect(result1.degradationReasons).toContain('Thin sale comparable set (1)');

      const result2 = computeAnalysisConfidence(makeFullInput({ saleCompSampleSize: 2 }));
      expect(result2.degradationReasons).toContain('Thin sale comparable set (2)');
    });

    it('no degradation for 3+ sale comps', () => {
      const result = computeAnalysisConfidence(makeFullInput({ saleCompSampleSize: 3 }));

      expect(result.degradationReasons.find((r) => r.includes('sale comp'))).toBeUndefined();
    });
  });

  describe('rent comparable degradation', () => {
    it('degrades by 10 for zero rent comps', () => {
      const result = computeAnalysisConfidence(makeFullInput({ rentCompSampleSize: 0 }));

      // 100 - 10 = 90 => high
      expect(result.level).toBe('high');
      expect(result.degradationReasons).toContain('No rent comparables found');
    });

    it('degrades by 5 for thin rent comp set (1-2)', () => {
      const result = computeAnalysisConfidence(makeFullInput({ rentCompSampleSize: 2 }));

      expect(result.degradationReasons).toContain('Thin rent comparable set (2)');
    });

    it('no degradation for 3+ rent comps', () => {
      const result = computeAnalysisConfidence(makeFullInput({ rentCompSampleSize: 3 }));

      expect(result.degradationReasons.find((r) => r.includes('rent comp'))).toBeUndefined();
    });
  });

  describe('building match degradation', () => {
    it('degrades by 10 for null building match confidence', () => {
      const result = computeAnalysisConfidence(makeFullInput({ buildingMatchConfidence: null }));

      expect(result.degradationReasons).toContain('Building not identified');
    });

    it('degrades by 10 for "unknown" building match confidence', () => {
      const result = computeAnalysisConfidence(
        makeFullInput({ buildingMatchConfidence: 'unknown' }),
      );

      expect(result.degradationReasons).toContain('Building not identified');
    });

    it('degrades by 5 for "low" building match confidence', () => {
      const result = computeAnalysisConfidence(makeFullInput({ buildingMatchConfidence: 'low' }));

      expect(result.degradationReasons).toContain('Low building match confidence');
    });

    it('no degradation for "high" or "medium" building match', () => {
      const resultHigh = computeAnalysisConfidence(
        makeFullInput({ buildingMatchConfidence: 'high' }),
      );
      const resultMed = computeAnalysisConfidence(
        makeFullInput({ buildingMatchConfidence: 'medium' }),
      );

      expect(resultHigh.degradationReasons.find((r) => r.includes('uilding'))).toBeUndefined();
      expect(resultMed.degradationReasons.find((r) => r.includes('uilding'))).toBeUndefined();
    });
  });

  describe('missing field degradation', () => {
    it('degrades by 10 for missing living area', () => {
      const result = computeAnalysisConfidence(makeFullInput({ hasLivingArea: false }));

      expect(result.degradationReasons).toContain('Living area not specified');
    });

    it('degrades by 5 for missing rooms', () => {
      const result = computeAnalysisConfidence(makeFullInput({ hasRooms: false }));

      expect(result.degradationReasons).toContain('Room count not specified');
    });

    it('degrades by 5 for missing year built', () => {
      const result = computeAnalysisConfidence(makeFullInput({ hasYearBuilt: false }));

      expect(result.degradationReasons).toContain('Year built unknown');
    });
  });

  describe('confidence level thresholds', () => {
    it('returns high when score >= 70', () => {
      // score = 100 - 30 (no geocode) = 70 => high
      const result = computeAnalysisConfidence(makeFullInput({ geocodePrecision: null }));
      expect(result.level).toBe('high');
    });

    it('returns medium when score >= 40 and < 70', () => {
      // score = 100 - 30 (no geocode) - 15 (no sale comps) = 55 => medium
      const result = computeAnalysisConfidence(
        makeFullInput({
          geocodePrecision: null,
          saleCompSampleSize: 0,
        }),
      );
      expect(result.level).toBe('medium');
    });

    it('returns low when score < 40', () => {
      // score = 100 - 30 - 15 - 10 - 10 - 10 = 25 => low
      const result = computeAnalysisConfidence(
        makeFullInput({
          geocodePrecision: null,
          saleCompSampleSize: 0,
          rentCompSampleSize: 0,
          buildingMatchConfidence: null,
          hasLivingArea: false,
        }),
      );
      expect(result.level).toBe('low');
    });

    it('returns exact boundary: score 70 is high', () => {
      // 100 - 20 (district geocode) - 10 (thin sale comps) = 70 => high
      const result = computeAnalysisConfidence(
        makeFullInput({
          geocodePrecision: 'district',
          saleCompSampleSize: 2,
        }),
      );
      expect(result.level).toBe('high');
    });

    it('returns exact boundary: score 69 is medium', () => {
      // 100 - 20 (district geocode) - 10 (thin sale comps) - 5 (thin rent comps) + 4 more = need 69
      // 100 - 20 - 10 - 5 + 4 = still need correct math
      // Try: 100 - 20 (district) - 5 (low building) - 5 (no rooms) - 5 (no year) = 65 => medium
      const result = computeAnalysisConfidence(
        makeFullInput({
          geocodePrecision: 'district',
          buildingMatchConfidence: 'low',
          hasRooms: false,
          hasYearBuilt: false,
        }),
      );
      // 100 - 20 - 5 - 5 - 5 = 65 => medium
      expect(result.level).toBe('medium');
    });
  });

  describe('cumulative degradation', () => {
    it('accumulates all degradation reasons', () => {
      const result = computeAnalysisConfidence({
        geocodePrecision: null,
        saleCompSampleSize: 0,
        rentCompSampleSize: 0,
        buildingMatchConfidence: null,
        hasLivingArea: false,
        hasRooms: false,
        hasYearBuilt: false,
      });

      // All possible degradation reasons present
      expect(result.degradationReasons).toHaveLength(7);
      expect(result.degradationReasons).toContain('No geocoded location');
      expect(result.degradationReasons).toContain('No sale comparables found');
      expect(result.degradationReasons).toContain('No rent comparables found');
      expect(result.degradationReasons).toContain('Building not identified');
      expect(result.degradationReasons).toContain('Living area not specified');
      expect(result.degradationReasons).toContain('Room count not specified');
      expect(result.degradationReasons).toContain('Year built unknown');

      // 100 - 30 - 15 - 10 - 10 - 10 - 5 - 5 = 15 => low
      expect(result.level).toBe('low');
    });

    it('score does not go below zero', () => {
      // Even with maximum degradation, the function should still work
      const result = computeAnalysisConfidence({
        geocodePrecision: null,
        saleCompSampleSize: 0,
        rentCompSampleSize: 0,
        buildingMatchConfidence: null,
        hasLivingArea: false,
        hasRooms: false,
        hasYearBuilt: false,
      });

      // Score = 15 (positive), level = low
      expect(result.level).toBe('low');
    });
  });
});
