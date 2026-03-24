import type { AnalysisConfidence, ConfidenceLevel } from '@immoradar/contracts';

/**
 * Compute overall analysis confidence based on data quality signals.
 * Confidence degrades when key inputs are missing or imprecise.
 */
export function computeAnalysisConfidence(params: {
  geocodePrecision: string | null;
  saleCompSampleSize: number;
  rentCompSampleSize: number;
  buildingMatchConfidence: string | null;
  hasLivingArea: boolean;
  hasRooms: boolean;
  hasYearBuilt: boolean;
}): AnalysisConfidence {
  const reasons: string[] = [];
  let score = 100; // Start at max, degrade

  // Geocode precision
  if (params.geocodePrecision == null || params.geocodePrecision === 'none') {
    reasons.push('No geocoded location');
    score -= 30;
  } else if (params.geocodePrecision === 'city' || params.geocodePrecision === 'district') {
    reasons.push('Location only approximate (district/city level)');
    score -= 20;
  }

  // Sale comparables
  if (params.saleCompSampleSize === 0) {
    reasons.push('No sale comparables found');
    score -= 15;
  } else if (params.saleCompSampleSize < 3) {
    reasons.push(`Thin sale comparable set (${params.saleCompSampleSize})`);
    score -= 10;
  }

  // Rent comparables
  if (params.rentCompSampleSize === 0) {
    reasons.push('No rent comparables found');
    score -= 10;
  } else if (params.rentCompSampleSize < 3) {
    reasons.push(`Thin rent comparable set (${params.rentCompSampleSize})`);
    score -= 5;
  }

  // Building match
  if (params.buildingMatchConfidence == null || params.buildingMatchConfidence === 'unknown') {
    reasons.push('Building not identified');
    score -= 10;
  } else if (params.buildingMatchConfidence === 'low') {
    reasons.push('Low building match confidence');
    score -= 5;
  }

  // Missing critical fields
  if (!params.hasLivingArea) {
    reasons.push('Living area not specified');
    score -= 10;
  }
  if (!params.hasRooms) {
    reasons.push('Room count not specified');
    score -= 5;
  }
  if (!params.hasYearBuilt) {
    reasons.push('Year built unknown');
    score -= 5;
  }

  let level: ConfidenceLevel;
  if (score >= 70) {
    level = 'high';
  } else if (score >= 40) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, degradationReasons: reasons };
}
