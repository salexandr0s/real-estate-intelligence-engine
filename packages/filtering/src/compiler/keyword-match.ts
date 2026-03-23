/**
 * Re-export keyword matching from @rei/contracts.
 * The canonical implementation lives in contracts to avoid circular dependencies.
 * This re-export preserves the @rei/filtering API surface.
 */
export {
  passesKeywordFilter,
  keywordMatches,
  buildMatchTarget,
  allRequiredKeywordsMatch,
  anyExcludedKeywordMatches,
  escapeForIlike,
} from '@rei/contracts';
