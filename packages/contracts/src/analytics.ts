/**
 * Analytics contract types for market trends and temperature data.
 */

export interface DistrictTrendPoint {
  districtNo: number;
  date: string;
  avgMedianPpsqm: number;
  totalSamples: number;
  avgP25: number | null;
  avgP75: number | null;
}

export type MarketTemperature = 'hot' | 'warm' | 'cool' | 'cold';

export interface MarketTemperaturePoint {
  districtNo: number;
  newLast7d: number;
  newLast30d: number;
  totalActive: number;
  currentAvgPpsqm: number;
  velocity: number;
  temperature: MarketTemperature;
}

/** Classify velocity into a temperature category. */
export function velocityToTemperature(velocity: number): MarketTemperature {
  if (velocity > 0.15) return 'hot';
  if (velocity > 0.08) return 'warm';
  if (velocity > 0.03) return 'cool';
  return 'cold';
}
