/**
 * Re-export keyword matching from @immoradar/contracts.
 * The canonical implementation lives in contracts to avoid circular dependencies.
 * This re-export preserves the @immoradar/filtering API surface.
 */
export {
  passesKeywordFilter,
  keywordMatches,
  buildMatchTarget,
  allRequiredKeywordsMatch,
  anyExcludedKeywordMatches,
  escapeForIlike,
} from '@immoradar/contracts';
