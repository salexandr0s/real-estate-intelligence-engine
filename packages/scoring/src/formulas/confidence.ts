/**
 * Computes confidence score: how much to trust the overall score.
 * Formula: 0.50 * completeness + 0.25 * baseline + 0.15 * source + 0.10 * location
 */
export function computeConfidenceScore(
  completenessScore: number,
  baselineConfidence: number,
  sourceReliability: number,
  locationConfidence: number,
): number {
  return Math.round(
    (0.50 * completenessScore +
     0.25 * baselineConfidence +
     0.15 * sourceReliability +
     0.10 * locationConfidence) * 100,
  ) / 100;
}
