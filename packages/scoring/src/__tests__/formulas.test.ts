import { describe, it, expect } from 'vitest';
import {
  mapDistrictDiscountToScore,
  mapBucketDiscountToScore,
  computeKeywordSignalScore,
  computeTimeOnMarketScore,
  computeConfidenceScore,
  scoreListing,
} from '../index.js';
import type { ScoreInput, BaselineLookup } from '@rei/contracts';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// ── District Price Score ────────────────────────────────────────────────────

describe('mapDistrictDiscountToScore edge cases', () => {
  it('returns 0 for extreme above-baseline', () => {
    expect(mapDistrictDiscountToScore(-0.30)).toBe(0);
  });

  it('returns 100 for extreme below-baseline', () => {
    expect(mapDistrictDiscountToScore(0.50)).toBe(100);
  });

  it('interpolates between 0% and 5%', () => {
    const score = mapDistrictDiscountToScore(0.025);
    expect(score).toBeGreaterThan(40);
    expect(score).toBeLessThan(65);
  });

  it('returns exact breakpoint values', () => {
    expect(mapDistrictDiscountToScore(-0.05)).toBe(20);
    expect(mapDistrictDiscountToScore(0.05)).toBe(65);
    expect(mapDistrictDiscountToScore(0.10)).toBe(80);
  });
});

// ── Bucket Undervaluation Score ─────────────────────────────────────────────

describe('mapBucketDiscountToScore sample thresholds', () => {
  it('halves score for very small sample (n=4)', () => {
    const base = mapBucketDiscountToScore(0.10, 25);
    const small = mapBucketDiscountToScore(0.10, 4);
    expect(small).toBeCloseTo(base * 0.5, 0);
  });

  it('uses 0.65 multiplier at sample=5', () => {
    const base = mapBucketDiscountToScore(0.10, 25);
    const mid = mapBucketDiscountToScore(0.10, 5);
    expect(mid).toBeCloseTo(base * 0.65, 0);
  });

  it('uses 0.85 multiplier at sample=10', () => {
    const base = mapBucketDiscountToScore(0.10, 25);
    const mid = mapBucketDiscountToScore(0.10, 10);
    expect(mid).toBeCloseTo(base * 0.85, 0);
  });

  it('uses 1.0 multiplier at sample=20+', () => {
    const s20 = mapBucketDiscountToScore(0.10, 20);
    const s25 = mapBucketDiscountToScore(0.10, 25);
    expect(s20).toBe(s25);
  });

  it('returns 25 for null discount', () => {
    expect(mapBucketDiscountToScore(null, 30)).toBe(25);
  });
});

// ── Keyword Signal Score ────────────────────────────────────────────────────

describe('computeKeywordSignalScore stacking', () => {
  it('stacks multiple quality keywords', () => {
    const result = computeKeywordSignalScore(
      'provisionsfrei saniert Terrasse', null, null,
    );
    expect(result.score).toBe(50 + 8 + 6 + 6); // 70
    expect(result.matchedPositive).toContain('provisionsfrei');
    expect(result.matchedPositive).toContain('saniert');
    expect(result.matchedPositive).toContain('terrasse');
  });

  it('handles umlaut normalization for opportunity keyword', () => {
    const result = computeKeywordSignalScore(
      'Sanierungsbedürftig Wohnung', null, 0.10,
    );
    // Opportunity keyword matched + 7%+ discount → renovation_opportunity
    expect(result.matchedPositive).toContain('renovation_opportunity');
  });

  it('returns neutral 50 for no keyword matches', () => {
    const result = computeKeywordSignalScore('Wohnung Wien', null, null);
    expect(result.score).toBe(50);
    expect(result.matchedPositive).toHaveLength(0);
    expect(result.matchedNegative).toHaveLength(0);
  });

  it('clamps to 0 for heavily negative listing', () => {
    const result = computeKeywordSignalScore(
      'schimmel feuchtigkeit baurecht', null, null,
    );
    // 50 - 25 - 20 - 20 = -15 → clamped to 0
    expect(result.score).toBe(0);
  });
});

// ── Time on Market Score ────────────────────────────────────────────────────

describe('computeTimeOnMarketScore combined penalties', () => {
  it('clamps to 0 for old listing with all penalties', () => {
    const score = computeTimeOnMarketScore(100, -0.05, 0, true);
    // Base ~20, -15 (old no discount), -20 (old above baseline), -10 (relist) = 0 clamped
    expect(score).toBe(0);
  });

  it('freshness curve at day 7 is 80', () => {
    expect(computeTimeOnMarketScore(7, null, 0, false)).toBe(80);
  });

  it('freshness curve at day 30 is 50', () => {
    expect(computeTimeOnMarketScore(30, null, 0, false)).toBe(50);
  });

  it('freshness curve at day 90 with null discount applies penalty', () => {
    // Base at day 90 = 25, but null discount → 0, which is < 0.03, so -15 penalty (day > 45)
    // Also <= 0, so -20 penalty (day > 90 not triggered since it requires > 90, not >= 90)
    // 25 - 15 = 10
    expect(computeTimeOnMarketScore(90, null, 0, false)).toBe(10);
  });
});

// ── Confidence Score ────────────────────────────────────────────────────────

describe('computeConfidenceScore', () => {
  it('computes weighted average', () => {
    const score = computeConfidenceScore(100, 100, 100, 100);
    expect(score).toBe(100);
  });

  it('computes weighted average with mixed values', () => {
    // 0.50*80 + 0.25*60 + 0.15*90 + 0.10*70 = 40 + 15 + 13.5 + 7 = 75.5
    const score = computeConfidenceScore(80, 60, 90, 70);
    expect(score).toBe(75.5);
  });
});

// ── Full Scoring Integration ────────────────────────────────────────────────

describe('scoreListing integration', () => {
  it('weights sum to 1.0 producing valid 0-100 score', () => {
    const input: ScoreInput = {
      listingId: 1,
      listingVersionId: 1,
      pricePerSqmEur: 5000,
      districtNo: 2,
      operationType: 'sale',
      propertyType: 'apartment',
      livingAreaSqm: 60,
      rooms: 3,
      city: 'Wien',
      title: 'Wohnung',
      description: null,
      firstSeenAt: daysAgo(5),
      lastPriceChangeAt: null,
      completenessScore: 80,
      sourceHealthScore: 90,
      locationConfidence: 85,
      recentPriceDropPct: 0,
      relistDetected: false,
    };
    const baseline: BaselineLookup = {
      districtBaselinePpsqmEur: 6000,
      bucketBaselinePpsqmEur: 5500,
      bucketSampleSize: 20,
      fallbackLevel: 'district_bucket',
    };

    const result = scoreListing(input, baseline);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.scoreVersion).toBe(1);
    expect(result.explanation).toHaveProperty('scoreVersion', 1);
  });

  it('includes baseline info in result', () => {
    const input: ScoreInput = {
      listingId: 1,
      listingVersionId: 1,
      pricePerSqmEur: 5000,
      districtNo: 2,
      operationType: 'sale',
      propertyType: 'apartment',
      livingAreaSqm: 60,
      rooms: 3,
      city: 'Wien',
      title: 'Wohnung',
      description: null,
      firstSeenAt: daysAgo(1),
      lastPriceChangeAt: null,
      completenessScore: 80,
      sourceHealthScore: 90,
      locationConfidence: 85,
      recentPriceDropPct: 0,
      relistDetected: false,
    };
    const baseline: BaselineLookup = {
      districtBaselinePpsqmEur: 6000,
      bucketBaselinePpsqmEur: 5500,
      bucketSampleSize: 20,
      fallbackLevel: 'district_bucket',
    };

    const result = scoreListing(input, baseline);
    expect(result.districtBaselinePpsqmEur).toBe(6000);
    expect(result.bucketBaselinePpsqmEur).toBe(5500);
    expect(result.discountToDistrictPct).toBeCloseTo((6000 - 5000) / 6000, 4);
    expect(result.discountToBucketPct).toBeCloseTo((5500 - 5000) / 5500, 4);
  });
});
