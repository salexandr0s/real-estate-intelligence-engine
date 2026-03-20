import { piecewiseLinear } from './util.js';

/**
 * Maps district discount percentage to a 0-100 score.
 * Positive discount = listing is cheaper than baseline.
 */
export function mapDistrictDiscountToScore(discountPct: number | null): number {
  if (discountPct == null) return 30;
  const breakpoints: Array<[number, number]> = [
    [-0.15, 0],
    [-0.05, 20],
    [0.0, 40],
    [0.05, 65],
    [0.10, 80],
    [0.15, 92],
    [0.20, 100],
  ];
  return Math.round(piecewiseLinear(discountPct, breakpoints) * 100) / 100;
}
