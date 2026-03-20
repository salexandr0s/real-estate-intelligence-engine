import { clamp, piecewiseLinear } from './util.js';

/**
 * Computes time-on-market score based on freshness and context adjustments.
 */
export function computeTimeOnMarketScore(
  daysOnMarket: number,
  districtDiscountPct: number | null,
  recentPriceDropPct: number,
  relistDetected: boolean,
): number {
  const freshnessBreakpoints: Array<[number, number]> = [
    [0, 95], [1, 95], [3, 90], [7, 80],
    [14, 65], [30, 50], [60, 35], [90, 25], [365, 20],
  ];

  let score = piecewiseLinear(daysOnMarket, freshnessBreakpoints);

  // Penalize old listings without discount
  const discount = districtDiscountPct ?? 0;
  if (daysOnMarket > 45 && discount < 0.03) score -= 15;
  if (daysOnMarket > 90 && discount <= 0) score -= 20;

  // Reward recent price drops
  if (recentPriceDropPct >= 0.03) score += 10;

  // Penalize relists
  if (relistDetected) score -= 10;

  return clamp(Math.round(score * 100) / 100, 0, 100);
}
