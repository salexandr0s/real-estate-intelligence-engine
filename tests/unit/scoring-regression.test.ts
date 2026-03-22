/**
 * Score regression fixture tests.
 * Tests three canonical scenarios to guard against scoring formula regressions.
 * Each scenario defines a ScoreInput + BaselineLookup and asserts the overall
 * score and component scores fall within expected ranges.
 */
import { describe, it, expect } from 'vitest';
import { scoreListing } from '@rei/scoring';
import type { ScoreInput, BaselineLookup } from '@rei/contracts';

// ── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function makeScoreInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
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
    firstSeenAt: daysAgo(7),
    lastPriceChangeAt: null,
    completenessScore: 85,
    sourceHealthScore: 95,
    locationConfidence: 90,
    recentPriceDropPct: 0,
    relistDetected: false,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<BaselineLookup> = {}): BaselineLookup {
  return {
    districtBaselinePpsqmEur: 6000,
    bucketBaselinePpsqmEur: 5800,
    bucketSampleSize: 25,
    fallbackLevel: 'district_bucket',
    ...overrides,
  };
}

// ── Fixture 1: Undervalued listing ─────────────────────────────────────────

describe('scoring regression: undervalued listing', () => {
  // Price 20% below district median, positive keywords, fresh (7 days)
  const districtMedian = 6000;
  const pricePerSqm = districtMedian * 0.8; // 4800 — 20% below
  const bucketMedian = 5800;

  const input = makeScoreInput({
    pricePerSqmEur: pricePerSqm,
    title: 'Schöne renovierte 3-Zimmer Wohnung mit Balkon',
    description: 'Frisch renoviert, helle Räume mit Balkon ins Grüne.',
    firstSeenAt: daysAgo(7),
    completenessScore: 90,
    sourceHealthScore: 95,
    locationConfidence: 90,
  });

  const baseline = makeBaseline({
    districtBaselinePpsqmEur: districtMedian,
    bucketBaselinePpsqmEur: bucketMedian,
    bucketSampleSize: 25,
    fallbackLevel: 'district_bucket',
  });

  const result = scoreListing(input, baseline);

  it('overall score is high (70+)', () => {
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
  });

  it('district price score reflects 20% discount', () => {
    // 20% discount maps to score 100 per district-price breakpoints
    expect(result.districtPriceScore).toBeGreaterThanOrEqual(95);
  });

  it('undervaluation score reflects bucket discount', () => {
    // ~17.2% bucket discount with sample size 25 → near 100
    expect(result.undervaluationScore).toBeGreaterThanOrEqual(80);
  });

  it('keyword signal reflects positive keywords', () => {
    // "renoviert" (+5) and "balkon" (+4) add to baseline 50 → 59
    expect(result.keywordSignalScore).toBeGreaterThanOrEqual(55);
    expect(result.matchedPositiveKeywords.length).toBeGreaterThanOrEqual(1);
  });

  it('time on market score reflects freshness', () => {
    // 7 days → ~80 per freshness breakpoints
    expect(result.timeOnMarketScore).toBeGreaterThanOrEqual(70);
  });

  it('confidence score reflects good data quality', () => {
    // completeness 90, baseline confidence 100, source 95, location 90
    // 0.50*90 + 0.25*100 + 0.15*95 + 0.10*90 = 45+25+14.25+9 = 93.25
    expect(result.confidenceScore).toBeGreaterThanOrEqual(85);
  });
});

// ── Fixture 2: Average listing ─────────────────────────────────────────────

describe('scoring regression: average listing', () => {
  // Price at median, no keywords, 30 days old
  const districtMedian = 6000;
  const pricePerSqm = districtMedian; // at median — 0% discount

  const input = makeScoreInput({
    pricePerSqmEur: pricePerSqm,
    title: '3-Zimmer Wohnung in Wien',
    description: null,
    firstSeenAt: daysAgo(30),
    completenessScore: 75,
    sourceHealthScore: 90,
    locationConfidence: 80,
  });

  const baseline = makeBaseline({
    districtBaselinePpsqmEur: districtMedian,
    bucketBaselinePpsqmEur: districtMedian,
    bucketSampleSize: 20,
    fallbackLevel: 'district_bucket',
  });

  const result = scoreListing(input, baseline);

  it('overall score is mid-range (35-55)', () => {
    expect(result.overallScore).toBeGreaterThanOrEqual(35);
    expect(result.overallScore).toBeLessThanOrEqual(55);
  });

  it('district price score at baseline is ~40', () => {
    // 0% discount maps to 40
    expect(result.districtPriceScore).toBeGreaterThanOrEqual(35);
    expect(result.districtPriceScore).toBeLessThanOrEqual(45);
  });

  it('undervaluation score at baseline is ~35', () => {
    // 0% discount with sample 20 → 35 * 0.85 ≈ 29.75
    expect(result.undervaluationScore).toBeGreaterThanOrEqual(25);
    expect(result.undervaluationScore).toBeLessThanOrEqual(40);
  });

  it('keyword signal is neutral (~50)', () => {
    // No significant keywords → neutral 50
    expect(result.keywordSignalScore).toBeGreaterThanOrEqual(45);
    expect(result.keywordSignalScore).toBeLessThanOrEqual(55);
  });

  it('time on market score is moderate', () => {
    // 30 days → ~50 per breakpoints
    expect(result.timeOnMarketScore).toBeGreaterThanOrEqual(35);
    expect(result.timeOnMarketScore).toBeLessThanOrEqual(55);
  });
});

// ── Fixture 3: Overpriced listing ──────────────────────────────────────────

describe('scoring regression: overpriced listing', () => {
  // Price 15% above median, negative keyword, 90 days old
  const districtMedian = 6000;
  const pricePerSqm = districtMedian * 1.15; // 6900 — 15% above

  const input = makeScoreInput({
    pricePerSqmEur: pricePerSqm,
    title: 'Sanierungsbedürftige Wohnung in Wien',
    description: 'Wohnung in guter Lage, benötigt umfassende Sanierung.',
    firstSeenAt: daysAgo(90),
    completenessScore: 60,
    sourceHealthScore: 85,
    locationConfidence: 70,
  });

  const baseline = makeBaseline({
    districtBaselinePpsqmEur: districtMedian,
    bucketBaselinePpsqmEur: districtMedian,
    bucketSampleSize: 20,
    fallbackLevel: 'district_bucket',
  });

  const result = scoreListing(input, baseline);

  it('overall score is low (10-35)', () => {
    expect(result.overallScore).toBeGreaterThanOrEqual(10);
    expect(result.overallScore).toBeLessThanOrEqual(35);
  });

  it('district price score reflects 15% premium', () => {
    // -15% discount maps to 0 per breakpoints
    expect(result.districtPriceScore).toBeLessThanOrEqual(5);
  });

  it('undervaluation score reflects premium', () => {
    // -15% discount → 0 per bucket breakpoints
    expect(result.undervaluationScore).toBeLessThanOrEqual(5);
  });

  it('keyword signal reflects negative context', () => {
    // "sanierungsbedürftig" is opportunity keyword; with -15% discount (< 3%),
    // renovation_no_discount penalty applies: 50 - 10 = 40
    expect(result.keywordSignalScore).toBeLessThanOrEqual(45);
    expect(result.matchedNegativeKeywords).toContain('renovation_no_discount');
  });

  it('time on market score reflects staleness', () => {
    // 90 days with no discount → base ~25, then penalties for old + no discount
    // daysOnMarket > 45 && discount < 0.03 → -15
    // daysOnMarket > 90 && discount <= 0 → -20
    // 25 - 15 - 20 = clamped to 0
    expect(result.timeOnMarketScore).toBeLessThanOrEqual(15);
  });
});
