/**
 * Shared keyword matching logic used by both:
 * - SQL ILIKE in build-search-query.ts (via contract — SQL mirrors this logic)
 * - JavaScript post-filter in user-filters.ts (reverse-match / alert path)
 *
 * This module is the single source of truth for keyword semantics.
 *
 * Contract:
 * - Keywords are lowercased and trimmed before matching
 * - Matching is case-insensitive substring search
 * - SQL wildcards (% and _) in the keyword are treated as literals, not wildcards
 * - Required keywords: ALL must match (AND semantics)
 * - Excluded keywords: NONE may match (NOT semantics)
 * - Match target: title + description concatenated with a space separator
 */

/**
 * Escape SQL ILIKE special characters so they match literally.
 * This must stay in sync with the ILIKE escaping in build-search-query.ts.
 */
export function escapeForIlike(keyword: string): string {
  return keyword.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Normalize a keyword for matching: trim whitespace, lowercase.
 */
function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

/**
 * Check if a single keyword matches against the combined text.
 * This is the JS equivalent of:
 *   text ILIKE '%' || escape(kw) || '%' ESCAPE '\\'
 *
 * Since JS includes() is a literal substring match and SQL ILIKE with
 * escaped wildcards is also a literal substring match, these are equivalent
 * when both sides use lowercased text and lowercased keywords.
 */
export function keywordMatches(text: string, keyword: string): boolean {
  const normalizedKw = normalizeKeyword(keyword);
  if (normalizedKw.length === 0) return true;
  return text.toLowerCase().includes(normalizedKw);
}

/**
 * Build the combined match target from title and description.
 * Both SQL and JS paths must use the same concatenation strategy.
 */
export function buildMatchTarget(title: string | null, description: string | null): string {
  return ((title ?? '') + ' ' + (description ?? '')).toLowerCase();
}

/**
 * Check if ALL required keywords match (AND semantics).
 */
export function allRequiredKeywordsMatch(text: string, requiredKeywords: string[]): boolean {
  if (requiredKeywords.length === 0) return true;
  return requiredKeywords.every((kw) => keywordMatches(text, kw));
}

/**
 * Check if ANY excluded keyword matches (returns true if exclusion triggered).
 */
export function anyExcludedKeywordMatches(text: string, excludedKeywords: string[]): boolean {
  if (excludedKeywords.length === 0) return false;
  return excludedKeywords.some((kw) => keywordMatches(text, kw));
}

/**
 * Full keyword filter check: required keywords all match AND no excluded keywords match.
 * This is the single function used by the reverse-match post-filter.
 */
export function passesKeywordFilter(
  title: string | null,
  description: string | null,
  requiredKeywords: string[],
  excludedKeywords: string[],
): boolean {
  const text = buildMatchTarget(title, description);
  if (!allRequiredKeywordsMatch(text, requiredKeywords)) return false;
  if (anyExcludedKeywordMatches(text, excludedKeywords)) return false;
  return true;
}
