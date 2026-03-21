/**
 * Scoring engine tests.
 * Tests all score components and the weighted final score.
 */
import { describe, it, expect } from 'vitest';

// ── Inline scoring functions for standalone testing ─────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

function piecewiseLinear(x: number, breakpoints: Array<[number, number]>): number {
  if (breakpoints.length === 0) return 0;
  if (x <= breakpoints[0]![0]) return breakpoints[0]![1];
  if (x >= breakpoints[breakpoints.length - 1]![0]) return breakpoints[breakpoints.length - 1]![1];

  for (let i = 1; i < breakpoints.length; i++) {
    const [x0, y0] = breakpoints[i - 1]!;
    const [x1, y1] = breakpoints[i]!;
    if (x >= x0 && x <= x1) {
      return lerp(x, x0, x1, y0, y1);
    }
  }
  return breakpoints[breakpoints.length - 1]![1];
}

function mapDistrictDiscountToScore(discountPct: number | null): number {
  if (discountPct == null) return 30; // no baseline = low-medium score
  // Breakpoints: discount -> score (positive discount = cheaper than baseline)
  const breakpoints: Array<[number, number]> = [
    [-0.15, 0],   // 15% above baseline
    [-0.05, 20],  // 5% above
    [0.0, 40],    // at baseline
    [0.05, 65],   // 5% below
    [0.10, 80],   // 10% below
    [0.15, 92],   // 15% below
    [0.20, 100],  // 20%+ below
  ];
  return Math.round(piecewiseLinear(discountPct, breakpoints) * 100) / 100;
}

function mapBucketDiscountToScore(discountPct: number | null, sampleSize: number): number {
  if (discountPct == null) return 25;
  const baseBreakpoints: Array<[number, number]> = [
    [-0.10, 0],
    [-0.05, 15],
    [0.0, 35],
    [0.05, 60],
    [0.10, 80],
    [0.15, 100],
  ];
  const base = piecewiseLinear(discountPct, baseBreakpoints);

  let multiplier = 1.0;
  if (sampleSize < 5) multiplier = 0.5; // use fallback
  else if (sampleSize < 10) multiplier = 0.65;
  else if (sampleSize < 20) multiplier = 0.85;

  return Math.round(base * multiplier * 100) / 100;
}

function computeKeywordSignalScore(
  title: string,
  description: string | null,
  bucketDiscountPct: number | null,
): { score: number; positiveMatches: string[]; negativeMatches: string[] } {
  const text = `${title} ${description ?? ''}`.toLowerCase();

  // Normalize umlauts for matching
  const normalized = text
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const both = `${text} ${normalized}`;

  let points = 50;
  const positiveMatches: string[] = [];
  const negativeMatches: string[] = [];

  // Quality keywords
  const qualityKeywords: Array<[string, number]> = [
    ['provisionsfrei', 8], ['lift', 4], ['balkon', 4],
    ['terrasse', 6], ['hofruhelage', 6], ['u-bahn', 5], ['saniert', 6],
  ];

  for (const [kw, weight] of qualityKeywords) {
    if (both.includes(kw)) {
      points += weight;
      positiveMatches.push(kw);
    }
  }

  // Risk keywords
  const riskKeywords: Array<[string, number]> = [
    ['unbefristet vermietet', 20], ['baurecht', 20], ['wohnrecht', 20],
    ['schimmel', 25], ['feuchtigkeit', 20], ['souterrain', 8],
    ['reparaturbedürftig', 10],
  ];
  const riskNormalized: Array<[string, number]> = [
    ['reparaturbeduertig', 10],
  ];

  for (const [kw, weight] of riskKeywords) {
    if (both.includes(kw)) {
      points -= weight;
      negativeMatches.push(kw);
    }
  }
  for (const [kw, weight] of riskNormalized) {
    if (normalized.includes(kw)) {
      points -= weight;
      if (!negativeMatches.includes(kw)) negativeMatches.push(kw);
    }
  }

  // Opportunity keywords (renovation)
  const renovationKeywords = ['sanierungsbedürftig', 'renovierungsbedürftig', 'bastlerhit',
    'sanierungsbeduertig', 'renovierungsbeduertig'];
  const hasRenovation = renovationKeywords.some(kw => both.includes(kw));
  if (hasRenovation) {
    const discount = bucketDiscountPct ?? 0;
    if (discount >= 0.07) {
      points += 10;
      positiveMatches.push('renovation_opportunity');
    } else if (discount >= 0.03) {
      // neutral
    } else {
      points -= 10;
      negativeMatches.push('renovation_no_discount');
    }
  }

  return {
    score: clamp(points, 0, 100),
    positiveMatches,
    negativeMatches,
  };
}

function computeTimeOnMarketScore(
  daysOnMarket: number,
  districtDiscountPct: number | null,
  recentPriceDropPct: number,
  relistDetected: boolean,
): number {
  // Base freshness
  const freshnessBreakpoints: Array<[number, number]> = [
    [0, 95], [1, 95], [2, 90], [3, 90],
    [4, 80], [7, 80], [8, 65], [14, 65],
    [15, 50], [30, 50], [31, 35], [60, 35],
    [61, 25], [90, 25], [91, 20], [365, 20],
  ];
  let score = piecewiseLinear(daysOnMarket, freshnessBreakpoints);

  // Adjustments
  if (daysOnMarket > 45 && (districtDiscountPct ?? 0) < 0.03) {
    score -= 15;
  }
  if (daysOnMarket > 90 && (districtDiscountPct ?? 0) <= 0) {
    score -= 20;
  }
  if (recentPriceDropPct >= 0.03) {
    score += 10;
  }
  if (relistDetected) {
    score -= 10;
  }

  return clamp(Math.round(score * 100) / 100, 0, 100);
}

function computeConfidenceScore(
  completenessScore: number,
  baselineConfidence: number,
  sourceReliability: number,
  locationConfidence: number,
): number {
  return Math.round(
    (0.50 * completenessScore +
     0.25 * baselineConfidence +
     0.15 * sourceReliability +
     0.10 * locationConfidence) * 100
  ) / 100;
}

const _SCORE_VERSION = 1;

interface ScoreTestInput {
  pricePerSqmEur: number | null;
  districtBaselinePpsqm: number | null;
  bucketBaselinePpsqm: number | null;
  bucketSampleSize: number;
  title: string;
  description: string | null;
  daysOnMarket: number;
  recentPriceDropPct: number;
  relistDetected: boolean;
  completenessScore: number;
  baselineConfidence: number;
  sourceReliability: number;
  locationConfidence: number;
}

function scoreListing(input: ScoreTestInput): {
  overallScore: number;
  districtPriceScore: number;
  undervaluationScore: number;
  keywordSignalScore: number;
  timeOnMarketScore: number;
  confidenceScore: number;
} {
  const districtDiscountPct = input.districtBaselinePpsqm && input.pricePerSqmEur
    ? (input.districtBaselinePpsqm - input.pricePerSqmEur) / input.districtBaselinePpsqm
    : null;

  const bucketDiscountPct = input.bucketBaselinePpsqm && input.pricePerSqmEur
    ? (input.bucketBaselinePpsqm - input.pricePerSqmEur) / input.bucketBaselinePpsqm
    : null;

  const districtPriceScore = mapDistrictDiscountToScore(districtDiscountPct);
  const undervaluationScore = mapBucketDiscountToScore(bucketDiscountPct, input.bucketSampleSize);
  const kw = computeKeywordSignalScore(input.title, input.description, bucketDiscountPct);
  const timeOnMarketScore = computeTimeOnMarketScore(
    input.daysOnMarket, districtDiscountPct, input.recentPriceDropPct, input.relistDetected
  );
  const confidenceScore = computeConfidenceScore(
    input.completenessScore, input.baselineConfidence,
    input.sourceReliability, input.locationConfidence
  );

  const raw =
    0.40 * districtPriceScore +
    0.25 * undervaluationScore +
    0.15 * kw.score +
    0.10 * timeOnMarketScore +
    0.10 * confidenceScore;

  return {
    overallScore: Math.round(clamp(raw, 0, 100) * 100) / 100,
    districtPriceScore,
    undervaluationScore,
    keywordSignalScore: kw.score,
    timeOnMarketScore,
    confidenceScore,
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
    expect(result.positiveMatches).toContain('provisionsfrei');
  });

  it('heavily penalizes baurecht', () => {
    const result = computeKeywordSignalScore('Wohnung mit Baurecht', null, null);
    expect(result.score).toBe(30); // 50 - 20
    expect(result.negativeMatches).toContain('baurecht');
  });

  it('rewards renovation with sufficient discount', () => {
    const result = computeKeywordSignalScore('Sanierungsbedürftig', null, 0.10);
    expect(result.score).toBe(60); // 50 + 10
    expect(result.positiveMatches).toContain('renovation_opportunity');
  });

  it('penalizes renovation without discount', () => {
    const result = computeKeywordSignalScore('Sanierungsbedürftig', null, 0.01);
    expect(result.score).toBe(40); // 50 - 10
    expect(result.negativeMatches).toContain('renovation_no_discount');
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

describe('scoreListing (worked example from docs)', () => {
  it('scores the example listing from scoring_engine.md', () => {
    const result = scoreListing({
      pricePerSqmEur: 5119.86,
      districtBaselinePpsqm: 6050.0,
      bucketBaselinePpsqm: 5700.0,
      bucketSampleSize: 24,
      title: '3-Zimmer Eigentumswohnung sanierungsbedürftig provisionsfrei',
      description: null,
      daysOnMarket: 2,
      recentPriceDropPct: 0,
      relistDetected: false,
      completenessScore: 86,
      baselineConfidence: 100,
      sourceReliability: 95,
      locationConfidence: 90,
    });

    // Overall should be around 85 per the docs example
    expect(result.overallScore).toBeGreaterThan(75);
    expect(result.overallScore).toBeLessThan(95);

    // District discount is ~15.37%, so district price score should be ~93
    expect(result.districtPriceScore).toBeGreaterThan(90);

    // Bucket discount is ~10.18%, so undervaluation should be ~80
    expect(result.undervaluationScore).toBeGreaterThan(70);

    // Time on market = 2 days → ~90
    expect(result.timeOnMarketScore).toBeGreaterThan(85);
  });

  it('penalizes expensive listings above baseline', () => {
    const result = scoreListing({
      pricePerSqmEur: 8000,
      districtBaselinePpsqm: 6050,
      bucketBaselinePpsqm: 5700,
      bucketSampleSize: 20,
      title: 'Luxuswohnung',
      description: null,
      daysOnMarket: 30,
      recentPriceDropPct: 0,
      relistDetected: false,
      completenessScore: 90,
      baselineConfidence: 100,
      sourceReliability: 95,
      locationConfidence: 90,
    });

    expect(result.overallScore).toBeLessThan(30);
    expect(result.districtPriceScore).toBeLessThan(10);
  });
});
