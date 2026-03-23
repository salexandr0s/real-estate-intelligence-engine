import { query } from '../client.js';
import type { ScoreResult } from '@rei/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface ListingScoreDbRow {
  id: string;
  listing_id: string;
  listing_version_id: string;
  score_version: number;
  overall_score: string;
  district_price_score: string;
  undervaluation_score: string;
  keyword_signal_score: string;
  time_on_market_score: string;
  confidence_score: string;
  location_score: string | null;
  district_baseline_ppsqm_eur: string | null;
  bucket_baseline_ppsqm_eur: string | null;
  discount_to_district_pct: string | null;
  discount_to_bucket_pct: string | null;
  matched_positive_keywords: string[];
  matched_negative_keywords: string[];
  baseline_fallback_level: string | null;
  baseline_sample_size: string | null;
  baseline_freshness_hours: string | null;
  explanation: Record<string, unknown>;
  scored_at: Date;
  created_at: Date;
}

function toScoreResult(row: ListingScoreDbRow): ScoreResult {
  return {
    overallScore: Number(row.overall_score),
    districtPriceScore: Number(row.district_price_score),
    undervaluationScore: Number(row.undervaluation_score),
    keywordSignalScore: Number(row.keyword_signal_score),
    timeOnMarketScore: Number(row.time_on_market_score),
    confidenceScore: Number(row.confidence_score),
    locationScore: row.location_score != null ? Number(row.location_score) : 50,
    districtBaselinePpsqmEur:
      row.district_baseline_ppsqm_eur != null ? Number(row.district_baseline_ppsqm_eur) : null,
    bucketBaselinePpsqmEur:
      row.bucket_baseline_ppsqm_eur != null ? Number(row.bucket_baseline_ppsqm_eur) : null,
    discountToDistrictPct:
      row.discount_to_district_pct != null ? Number(row.discount_to_district_pct) : null,
    discountToBucketPct:
      row.discount_to_bucket_pct != null ? Number(row.discount_to_bucket_pct) : null,
    matchedPositiveKeywords: row.matched_positive_keywords,
    matchedNegativeKeywords: row.matched_negative_keywords,
    explanation: row.explanation,
    scoreVersion: row.score_version,
    baselineFallbackLevel: row.baseline_fallback_level ?? undefined,
    baselineSampleSize:
      row.baseline_sample_size != null ? Number(row.baseline_sample_size) : undefined,
    baselineFreshnessHours:
      row.baseline_freshness_hours != null ? Number(row.baseline_freshness_hours) : undefined,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function insertScore(
  listingId: number,
  listingVersionId: number,
  score: ScoreResult,
): Promise<void> {
  await query(
    `INSERT INTO listing_scores (
       listing_id, listing_version_id, score_version,
       overall_score, district_price_score, undervaluation_score,
       keyword_signal_score, time_on_market_score, confidence_score,
       location_score,
       district_baseline_ppsqm_eur, bucket_baseline_ppsqm_eur,
       discount_to_district_pct, discount_to_bucket_pct,
       matched_positive_keywords, matched_negative_keywords,
       explanation,
       baseline_fallback_level, baseline_sample_size, baseline_freshness_hours,
       scored_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
       $18, $19, $20, NOW()
     )
     ON CONFLICT (listing_version_id, score_version) DO UPDATE SET
       overall_score = EXCLUDED.overall_score,
       district_price_score = EXCLUDED.district_price_score,
       undervaluation_score = EXCLUDED.undervaluation_score,
       keyword_signal_score = EXCLUDED.keyword_signal_score,
       time_on_market_score = EXCLUDED.time_on_market_score,
       confidence_score = EXCLUDED.confidence_score,
       location_score = EXCLUDED.location_score,
       baseline_fallback_level = EXCLUDED.baseline_fallback_level,
       baseline_sample_size = EXCLUDED.baseline_sample_size,
       baseline_freshness_hours = EXCLUDED.baseline_freshness_hours,
       scored_at = NOW()`,
    [
      listingId,
      listingVersionId,
      score.scoreVersion,
      score.overallScore,
      score.districtPriceScore,
      score.undervaluationScore,
      score.keywordSignalScore,
      score.timeOnMarketScore,
      score.confidenceScore,
      score.locationScore,
      score.districtBaselinePpsqmEur,
      score.bucketBaselinePpsqmEur,
      score.discountToDistrictPct,
      score.discountToBucketPct,
      score.matchedPositiveKeywords,
      score.matchedNegativeKeywords,
      JSON.stringify(score.explanation),
      score.baselineFallbackLevel ?? null,
      score.baselineSampleSize ?? null,
      score.baselineFreshnessHours ?? null,
    ],
  );
}

export async function findLatestByListingId(listingId: number): Promise<ScoreResult | null> {
  const rows = await query<ListingScoreDbRow>(
    `SELECT * FROM listing_scores
     WHERE listing_id = $1
     ORDER BY scored_at DESC
     LIMIT 1`,
    [listingId],
  );
  const row = rows[0];
  return row ? toScoreResult(row) : null;
}
