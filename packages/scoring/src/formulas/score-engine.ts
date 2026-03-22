import type { BaselineLookup, ScoreInput, ScoreResult } from '@rei/contracts';
import { mapDistrictDiscountToScore } from './district-price.js';
import { mapBucketDiscountToScore } from './undervaluation.js';
import { computeKeywordSignalScore } from './keyword-signal.js';
import { computeTimeOnMarketScore } from './time-on-market.js';
import { computeConfidenceScore } from './confidence.js';
import { computeLocationScore } from './location-score.js';
import { clamp } from './util.js';

export const SCORE_VERSION = 2;

/**
 * Main scoring function. Produces a 0-100 weighted opportunity score.
 * Weights: 0.35 district + 0.20 undervaluation + 0.15 keyword + 0.10 time + 0.10 confidence + 0.10 location
 */
export function scoreListing(input: ScoreInput, baseline: BaselineLookup): ScoreResult {
  const districtDiscountPct =
    baseline.districtBaselinePpsqmEur && input.pricePerSqmEur
      ? (baseline.districtBaselinePpsqmEur - input.pricePerSqmEur) /
        baseline.districtBaselinePpsqmEur
      : null;

  const bucketDiscountPct =
    baseline.bucketBaselinePpsqmEur && input.pricePerSqmEur
      ? (baseline.bucketBaselinePpsqmEur - input.pricePerSqmEur) / baseline.bucketBaselinePpsqmEur
      : null;

  const districtPriceScore = mapDistrictDiscountToScore(districtDiscountPct);
  const undervaluationScore = mapBucketDiscountToScore(
    bucketDiscountPct,
    baseline.bucketSampleSize,
  );

  const kw = computeKeywordSignalScore(input.title, input.description, bucketDiscountPct);

  const daysOnMarket = Math.max(
    0,
    Math.floor((Date.now() - input.firstSeenAt.getTime()) / 86400000),
  );

  const recentPriceDropPct = input.recentPriceDropPct;
  const relistDetected = input.relistDetected;

  const timeOnMarketScore = computeTimeOnMarketScore(
    daysOnMarket,
    districtDiscountPct,
    recentPriceDropPct,
    relistDetected,
  );

  // Baseline confidence from fallback level
  let baselineConfidence = 20;
  switch (baseline.fallbackLevel) {
    case 'district_bucket':
      baselineConfidence = 100;
      break;
    case 'district_type':
      baselineConfidence = 80;
      break;
    case 'city_bucket':
      baselineConfidence = 60;
      break;
    case 'city_type':
      baselineConfidence = 40;
      break;
    case 'none':
      baselineConfidence = 20;
      break;
  }

  const confidenceScore = computeConfidenceScore(
    input.completenessScore,
    baselineConfidence,
    input.sourceHealthScore,
    input.locationConfidence,
  );

  const locationScore = computeLocationScore(input.proximityData);

  const raw =
    0.35 * districtPriceScore +
    0.2 * undervaluationScore +
    0.15 * kw.score +
    0.1 * timeOnMarketScore +
    0.1 * confidenceScore +
    0.1 * locationScore;

  const overallScore = Math.round(clamp(raw, 0, 100) * 100) / 100;

  return {
    overallScore,
    districtPriceScore,
    undervaluationScore,
    keywordSignalScore: kw.score,
    timeOnMarketScore,
    confidenceScore,
    locationScore,
    districtBaselinePpsqmEur: baseline.districtBaselinePpsqmEur,
    bucketBaselinePpsqmEur: baseline.bucketBaselinePpsqmEur,
    discountToDistrictPct: districtDiscountPct,
    discountToBucketPct: bucketDiscountPct,
    matchedPositiveKeywords: kw.matchedPositive,
    matchedNegativeKeywords: kw.matchedNegative,
    explanation: {
      scoreVersion: SCORE_VERSION,
      daysOnMarket,
      baselineConfidence,
      fallbackLevel: baseline.fallbackLevel,
      locationScore,
      proximityData: input.proximityData ?? null,
    },
    scoreVersion: SCORE_VERSION,
  };
}
