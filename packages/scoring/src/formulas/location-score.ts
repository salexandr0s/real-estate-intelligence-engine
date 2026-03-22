import type { ProximityInput } from '@rei/contracts';
import { piecewiseLinear, clamp } from './util.js';

export function computeLocationScore(input: ProximityInput | null | undefined): number {
  if (!input) return 50; // neutral default

  // Transit sub-score (50% weight)
  let transitScore = 20; // default: no transit nearby
  if (input.nearestTransitDistanceM != null) {
    const isUbahn = input.nearestTransitType === 'u-bahn';
    if (isUbahn) {
      transitScore = piecewiseLinear(input.nearestTransitDistanceM, [
        [0, 100],
        [300, 90],
        [500, 70],
        [1000, 40],
        [2000, 20],
      ]);
    } else {
      transitScore = piecewiseLinear(input.nearestTransitDistanceM, [
        [0, 90],
        [200, 80],
        [400, 60],
        [800, 35],
        [1500, 20],
      ]);
    }
  }

  // Green space sub-score (25% weight)
  const greenScore = piecewiseLinear(input.parksWithin500m, [
    [0, 30],
    [1, 70],
    [2, 90],
    [3, 100],
  ]);

  // Infrastructure sub-score (15% weight)
  const schoolScore = piecewiseLinear(input.schoolsWithin500m, [
    [0, 40],
    [1, 70],
    [2, 90],
    [3, 100],
  ]);
  const policeScore = input.policeWithin1000m > 0 ? 80 : 50;
  const infraScore = 0.7 * schoolScore + 0.3 * policeScore;

  // Density sub-score (10% weight)
  const totalNearby =
    input.transitStopsWithin500m + input.parksWithin500m + input.schoolsWithin500m;
  const densityScore = piecewiseLinear(totalNearby, [
    [0, 20],
    [3, 50],
    [6, 75],
    [10, 90],
    [15, 100],
  ]);

  const raw = 0.5 * transitScore + 0.25 * greenScore + 0.15 * infraScore + 0.1 * densityScore;
  return Math.round(clamp(raw, 0, 100) * 100) / 100;
}
