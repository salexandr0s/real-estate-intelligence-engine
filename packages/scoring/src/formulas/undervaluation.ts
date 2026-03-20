import { piecewiseLinear } from './util.js';

/**
 * Maps bucket discount percentage to a 0-100 score with sample-size confidence.
 */
export function mapBucketDiscountToScore(
  discountPct: number | null,
  sampleSize: number,
): number {
  if (discountPct == null) return 25;

  const breakpoints: Array<[number, number]> = [
    [-0.10, 0],
    [-0.05, 15],
    [0.0, 35],
    [0.05, 60],
    [0.10, 80],
    [0.15, 100],
  ];

  const base = piecewiseLinear(discountPct, breakpoints);

  let multiplier = 1.0;
  if (sampleSize < 5) multiplier = 0.5;
  else if (sampleSize < 10) multiplier = 0.65;
  else if (sampleSize < 20) multiplier = 0.85;

  return Math.round(base * multiplier * 100) / 100;
}
