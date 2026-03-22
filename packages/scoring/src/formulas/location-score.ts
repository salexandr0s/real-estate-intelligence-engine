import type { ProximityInput } from '@rei/contracts';
import { piecewiseLinear, clamp } from './util.js';

export function computeLocationScore(input: ProximityInput | null | undefined): number {
  if (!input) return 50; // neutral default

  // ── Transit sub-score (35% weight) ──────────────────────────────────────────
  // Best of three type-adjusted scores: U-Bahn > Tram > Bus
  let transitScore = 20; // default: no transit nearby

  const ubahnScore =
    input.nearestUbahnDistanceM != null
      ? piecewiseLinear(input.nearestUbahnDistanceM, [
          [0, 100],
          [300, 90],
          [500, 70],
          [1000, 40],
          [2000, 20],
        ])
      : 0;

  const tramScore =
    input.nearestTramDistanceM != null
      ? piecewiseLinear(input.nearestTramDistanceM, [
          [0, 95],
          [200, 85],
          [400, 65],
          [800, 40],
          [1500, 20],
        ])
      : 0;

  const busScore =
    input.nearestBusDistanceM != null
      ? piecewiseLinear(input.nearestBusDistanceM, [
          [0, 90],
          [200, 80],
          [400, 60],
          [800, 35],
          [1500, 20],
        ])
      : 0;

  const bestTransit = Math.max(ubahnScore, tramScore, busScore);
  if (bestTransit > 0) transitScore = bestTransit;

  // ── Green space sub-score (20% weight) ──────────────────────────────────────
  const greenScore = piecewiseLinear(input.parksWithin500m, [
    [0, 30],
    [1, 70],
    [2, 90],
    [3, 100],
  ]);

  // ── Infrastructure sub-score (10% weight) — education ───────────────────────
  const infraScore = piecewiseLinear(input.schoolsWithin500m, [
    [0, 40],
    [1, 70],
    [2, 90],
    [3, 100],
  ]);

  // ── Daily life sub-score (20% weight) — supermarkets + healthcare ───────────
  const supermarketScore = piecewiseLinear(input.supermarketsWithin500m, [
    [0, 30],
    [1, 75],
    [2, 95],
    [3, 100],
  ]);
  const doctorScore = piecewiseLinear(input.doctorsWithin500m, [
    [0, 50],
    [1, 70],
    [2, 85],
    [3, 100],
  ]);
  const hospitalScore = input.hospitalsWithin2000m > 0 ? 80 : 40;
  const dailyLifeScore = 0.6 * supermarketScore + 0.2 * doctorScore + 0.2 * hospitalScore;

  // ── Safety sub-score (5% weight) — police + fire ────────────────────────────
  const policeScore = input.policeWithin1000m > 0 ? 80 : 50;
  const fireScore = input.fireStationsWithin1000m > 0 ? 80 : 50;
  const safetyScore = 0.6 * policeScore + 0.4 * fireScore;

  // ── Density sub-score (10% weight) ──────────────────────────────────────────
  const totalNearby =
    input.parksWithin500m +
    input.schoolsWithin500m +
    input.supermarketsWithin500m +
    input.doctorsWithin500m;
  const densityScore = piecewiseLinear(totalNearby, [
    [0, 20],
    [3, 50],
    [6, 75],
    [10, 90],
    [15, 100],
  ]);

  // ── Weighted combination ────────────────────────────────────────────────────
  const raw =
    0.35 * transitScore +
    0.2 * greenScore +
    0.1 * infraScore +
    0.2 * dailyLifeScore +
    0.05 * safetyScore +
    0.1 * densityScore;

  return Math.round(clamp(raw, 0, 100) * 100) / 100;
}
