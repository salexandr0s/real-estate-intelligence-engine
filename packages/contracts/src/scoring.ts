// ── Score Input ──────────────────────────────────────────────────────────────

export interface ScoreInput {
  listingId: number;
  listingVersionId: number;
  pricePerSqmEur: number | null;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  livingAreaSqm: number | null;
  rooms: number | null;
  city: string;
  title: string;
  description: string | null;
  firstSeenAt: Date;
  lastPriceChangeAt: Date | null;
  completenessScore: number;
  sourceHealthScore: number;
  locationConfidence: number;
}

// ── Baseline ────────────────────────────────────────────────────────────────

export interface BaselineLookup {
  districtBaselinePpsqmEur: number | null;
  bucketBaselinePpsqmEur: number | null;
  bucketSampleSize: number;
  fallbackLevel: 'district_bucket' | 'district_type' | 'city_bucket' | 'city_type' | 'none';
}

// ── Score Result ────────────────────────────────────────────────────────────

export interface ScoreResult {
  overallScore: number;
  districtPriceScore: number;
  undervaluationScore: number;
  keywordSignalScore: number;
  timeOnMarketScore: number;
  confidenceScore: number;
  districtBaselinePpsqmEur: number | null;
  bucketBaselinePpsqmEur: number | null;
  discountToDistrictPct: number | null;
  discountToBucketPct: number | null;
  matchedPositiveKeywords: string[];
  matchedNegativeKeywords: string[];
  explanation: Record<string, unknown>;
  scoreVersion: number;
}

// ── Keyword Lexicon ─────────────────────────────────────────────────────────

export interface KeywordEntry {
  term: string;
  category: 'quality' | 'opportunity' | 'risk';
  weight: number;
}

// ── Area / Room Buckets ─────────────────────────────────────────────────────

export function getAreaBucket(areaSqm: number | null): string {
  if (areaSqm == null) return 'unknown';
  if (areaSqm < 40) return '<40';
  if (areaSqm < 50) return '40-49.99';
  if (areaSqm < 60) return '50-59.99';
  if (areaSqm < 80) return '60-79.99';
  if (areaSqm < 100) return '80-99.99';
  if (areaSqm < 150) return '100-149.99';
  return '150+';
}

export function getRoomBucket(rooms: number | null): string {
  if (rooms == null) return 'unknown';
  if (rooms < 1.5) return '1';
  if (rooms < 2.5) return '2';
  if (rooms < 3.5) return '3';
  if (rooms < 4.5) return '4';
  return '5+';
}
