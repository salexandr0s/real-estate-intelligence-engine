/**
 * Scoring engine tests.
 * Tests all score components and the weighted final score.
 * Imports from @rei/scoring — no inline re-implementations.
 */
import { describe, it, expect } from 'vitest';
import {
  mapDistrictDiscountToScore,
  mapBucketDiscountToScore,
  computeKeywordSignalScore,
  computeTimeOnMarketScore,
  computeConfidenceScore,
  scoreListing,
} from '@rei/scoring';
import type { ScoreInput, BaselineLookup } from '@rei/contracts';

// ── Helper: build ScoreInput with sensible defaults ──────────────────────

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function makeScoreInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    listingId: 1,
    listingVersionId: 1,
    pricePerSqmEur: 5119.86,
    districtNo: 2,
    operationType: 'sale',
    propertyType: 'apartment',
    livingAreaSqm: 58.4,
    rooms: 3,
    city: 'Wien',
    title: '3-Zimmer Eigentumswohnung',
    description: null,
    firstSeenAt: daysAgo(2),
    lastPriceChangeAt: null,
    completenessScore: 86,
    sourceHealthScore: 95,
    locationConfidence: 90,
    recentPriceDropPct: 0,
    relistDetected: false,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<BaselineLookup> = {}): BaselineLookup {
  return {
    districtBaselinePpsqmEur: 6050.0,
    bucketBaselinePpsqmEur: 5700.0,
    bucketSampleSize: 24,
    fallbackLevel: 'district_bucket',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('mapDistrictDiscountToScore', () => {
  it('returns 100 for 20%+ below baseline', () => {
    expect(mapDistrictDiscountToScore(0.25)).toBe(100);
  });

  it('returns 40 at baseline', () => {
    expect(mapDistrictDiscountToScore(0.0)).toBe(40);
  });

  it('returns 0 for 15%+ above baseline', () => {
    expect(mapDistrictDiscountToScore(-0.15)).toBe(0);
  });

  it('interpolates for ~15% below', () => {
    const score = mapDistrictDiscountToScore(0.15);
    expect(score).toBeCloseTo(92, 0);
  });

  it('returns 30 for null (no baseline)', () => {
    expect(mapDistrictDiscountToScore(null)).toBe(30);
  });
});

describe('mapBucketDiscountToScore', () => {
  it('returns 100 for 15%+ below with good sample', () => {
    expect(mapBucketDiscountToScore(0.15, 25)).toBe(100);
  });

  it('applies sample size multiplier for small samples', () => {
    const full = mapBucketDiscountToScore(0.10, 25);
    const small = mapBucketDiscountToScore(0.10, 8);
    expect(small).toBeLessThan(full);
    expect(small).toBeCloseTo(full * 0.65, 0);
  });

  it('returns 35 at baseline with good sample', () => {
    expect(mapBucketDiscountToScore(0.0, 25)).toBe(35);
  });
});

describe('computeKeywordSignalScore', () => {
  it('adds points for provisionsfrei', () => {
    const result = computeKeywordSignalScore('3-Zimmer provisionsfrei', null, null);
    expect(result.score).toBe(58); // 50 + 8
    expect(result.matchedPositive).toContain('provisionsfrei');
  });

  it('heavily penalizes baurecht', () => {
    const result = computeKeywordSignalScore('Wohnung mit Baurecht', null, null);
    expect(result.score).toBe(30); // 50 - 20
    expect(result.matchedNegative).toContain('baurecht');
  });

  it('rewards renovation with sufficient discount', () => {
    const result = computeKeywordSignalScore('Sanierungsbedürftig', null, 0.10);
    expect(result.score).toBe(60); // 50 + 10
    expect(result.matchedPositive).toContain('renovation_opportunity');
  });

  it('penalizes renovation without discount', () => {
    const result = computeKeywordSignalScore('Sanierungsbedürftig', null, 0.01);
    expect(result.score).toBe(40); // 50 - 10
    expect(result.matchedNegative).toContain('renovation_no_discount');
  });
});

describe('computeTimeOnMarketScore', () => {
  it('gives high score for fresh listings', () => {
    expect(computeTimeOnMarketScore(1, 0.10, 0, false)).toBe(95);
  });

  it('penalizes old listings without discount', () => {
    const score = computeTimeOnMarketScore(100, 0.01, 0, false);
    expect(score).toBeLessThan(20);
  });

  it('boosts score for recent price drop', () => {
    const withDrop = computeTimeOnMarketScore(20, 0.05, 0.05, false);
    const without = computeTimeOnMarketScore(20, 0.05, 0, false);
    expect(withDrop).toBeGreaterThan(without);
  });

  it('penalizes relist', () => {
    const normal = computeTimeOnMarketScore(5, 0.10, 0, false);
    const relist = computeTimeOnMarketScore(5, 0.10, 0, true);
    expect(relist).toBe(normal - 10);
  });
});

describe('scoreListing (worked example)', () => {
  it('scores a typical below-baseline listing', () => {
    const input = makeScoreInput({
      title: '3-Zimmer Eigentumswohnung sanierungsbedürftig provisionsfrei',
    });
    const baseline = makeBaseline();
    const result = scoreListing(input, baseline);

    // Overall should be around 85
    expect(result.overallScore).toBeGreaterThan(75);
    expect(result.overallScore).toBeLessThan(95);

    // District discount is ~15.37%, so district price score should be ~93
    expect(result.districtPriceScore).toBeGreaterThan(90);

    // Bucket discount is ~10.18%, so undervaluation should be ~80
    expect(result.undervaluationScore).toBeGreaterThan(70);

    // Fresh listing → high time-on-market score
    expect(result.timeOnMarketScore).toBeGreaterThan(85);
  });

  it('penalizes expensive listings above baseline', () => {
    const input = makeScoreInput({
      pricePerSqmEur: 8000,
      title: 'Luxuswohnung',
      firstSeenAt: daysAgo(30),
    });
    const baseline = makeBaseline();
    const result = scoreListing(input, baseline);

    expect(result.overallScore).toBeLessThan(30);
    expect(result.districtPriceScore).toBeLessThan(10);
  });
});
