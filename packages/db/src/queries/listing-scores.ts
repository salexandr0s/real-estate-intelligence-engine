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
  district_baseline_ppsqm_eur: string | null;
  bucket_baseline_ppsqm_eur: string | null;
  discount_to_district_pct: string | null;
  discount_to_bucket_pct: string | null;
  matched_positive_keywords: string[];
  matched_negative_keywords: string[];
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
    districtBaselinePpsqmEur: row.district_baseline_ppsqm_eur != null ? Number(row.district_baseline_ppsqm_eur) : null,
    bucketBaselinePpsqmEur: row.bucket_baseline_ppsqm_eur != null ? Number(row.bucket_baseline_ppsqm_eur) : null,
    discountToDistrictPct: row.discount_to_district_pct != null ? Number(row.discount_to_district_pct) : null,
    discountToBucketPct: row.discount_to_bucket_pct != null ? Number(row.discount_to_bucket_pct) : null,
    matchedPositiveKeywords: row.matched_positive_keywords,
    matchedNegativeKeywords: row.matched_negative_keywords,
    explanation: row.explanation,
    scoreVersion: row.score_version,
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
       district_baseline_ppsqm_eur, bucket_baseline_ppsqm_eur,
       discount_to_district_pct, discount_to_bucket_pct,
       matched_positive_keywords, matched_negative_keywords,
       explanation, scored_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW()
     )`,
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
      score.districtBaselinePpsqmEur,
      score.bucketBaselinePpsqmEur,
      score.discountToDistrictPct,
      score.discountToBucketPct,
      score.matchedPositiveKeywords,
      score.matchedNegativeKeywords,
      JSON.stringify(score.explanation),
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
