import { matchKeywords } from '../keywords/lexicon.js';
import { clamp } from './util.js';

/**
 * Computes keyword signal score from title and description text.
 * Starts from neutral 50, adjusts based on keyword matches.
 */
export function computeKeywordSignalScore(
  title: string,
  description: string | null,
  bucketDiscountPct: number | null,
): {
  score: number;
  matchedPositive: string[];
  matchedNegative: string[];
} {
  const text = `${title} ${description ?? ''}`;
  const { positive, negative, opportunity } = matchKeywords(text);

  let points = 50;
  const matchedPositive: string[] = [];
  const matchedNegative: string[] = [];

  for (const kw of positive) {
    points += kw.weight;
    matchedPositive.push(kw.term);
  }

  for (const kw of negative) {
    points -= kw.weight;
    matchedNegative.push(kw.term);
  }

  // Renovation-needed rule
  if (opportunity.length > 0) {
    const discount = bucketDiscountPct ?? 0;
    if (discount >= 0.07) {
      points += 10;
      matchedPositive.push('renovation_opportunity');
    } else if (discount < 0.03) {
      points -= 10;
      matchedNegative.push('renovation_no_discount');
    }
  }

  return {
    score: clamp(points, 0, 100),
    matchedPositive,
    matchedNegative,
  };
}
