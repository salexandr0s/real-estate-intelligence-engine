import type {
  ComparableEntry,
  ComparableFallbackLevel,
  ConfidenceLevel,
  MarketRentEstimate,
} from '@rei/contracts';

/**
 * Estimate market rent from rent-type comparables.
 *
 * Uses trimmed median €/sqm from the comp set, then multiplies
 * by the target area to derive a band (low/mid/high).
 *
 * The estimate always exposes:
 * - sample size: how many comps were used
 * - fallback level: nearby / district / city
 * - confidence: based on sample size and fallback level
 */
export function estimateMarketRent(
  rentComps: ComparableEntry[],
  targetAreaSqm: number | null,
  fallbackLevel: ComparableFallbackLevel,
): MarketRentEstimate {
  // Filter to comps with valid price per sqm
  const validComps = rentComps.filter((c) => c.pricePerSqmEur != null && c.pricePerSqmEur > 0);

  if (validComps.length === 0 || targetAreaSqm == null || targetAreaSqm <= 0) {
    return {
      estimateLow: null,
      estimateMid: null,
      estimateHigh: null,
      eurPerSqmMid: null,
      fallbackLevel,
      sampleSize: 0,
      confidence: 'low',
    };
  }

  // Sort by price per sqm for percentile calculations
  const ppsqmValues = validComps.map((c) => c.pricePerSqmEur!).sort((a, b) => a - b);

  // Trim outliers: remove top and bottom 10% if sample >= 5
  const trimmed = trimOutliers(ppsqmValues, 0.1);

  const median = computeMedian(trimmed);
  const p25 = computePercentile(trimmed, 0.25);
  const p75 = computePercentile(trimmed, 0.75);

  const estimateMid = Math.round(median * targetAreaSqm);
  const estimateLow = Math.round(p25 * targetAreaSqm);
  const estimateHigh = Math.round(p75 * targetAreaSqm);

  const confidence = deriveConfidence(validComps.length, fallbackLevel);

  return {
    estimateLow,
    estimateMid,
    estimateHigh,
    eurPerSqmMid: Math.round(median * 100) / 100,
    fallbackLevel,
    sampleSize: validComps.length,
    confidence,
  };
}

function trimOutliers(sorted: number[], trimPct: number): number[] {
  if (sorted.length < 5) return sorted;
  const trimCount = Math.floor(sorted.length * trimPct);
  return sorted.slice(trimCount, sorted.length - trimCount);
}

function computeMedian(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function deriveConfidence(
  sampleSize: number,
  fallbackLevel: ComparableFallbackLevel,
): ConfidenceLevel {
  if (fallbackLevel === 'nearby' && sampleSize >= 5) return 'high';
  if (fallbackLevel === 'nearby' && sampleSize >= 2) return 'medium';
  if (fallbackLevel === 'district' && sampleSize >= 10) return 'medium';
  return 'low';
}
