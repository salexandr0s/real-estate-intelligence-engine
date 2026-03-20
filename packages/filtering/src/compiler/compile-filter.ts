import type { CompiledFilter, FilterCriteria } from '@rei/contracts';

export function compileFilter(criteria: FilterCriteria): CompiledFilter {
  const compiled: CompiledFilter = {
    sortBy: criteria.sortBy ?? 'score_desc',
  };

  if (criteria.operationType) compiled.operationType = criteria.operationType;

  if (criteria.propertyTypes?.length) {
    compiled.propertyTypes = [...criteria.propertyTypes];
  }

  if (criteria.districts?.length) {
    compiled.districts = [...new Set(criteria.districts)].sort((a, b) => a - b);
  }

  if (criteria.postalCodes?.length) {
    compiled.postalCodes = [...new Set(criteria.postalCodes)].sort();
  }

  if (criteria.minPriceEur != null) compiled.minPriceCents = Math.round(criteria.minPriceEur * 100);
  if (criteria.maxPriceEur != null) compiled.maxPriceCents = Math.round(criteria.maxPriceEur * 100);
  if (criteria.minAreaSqm != null) compiled.minAreaSqm = criteria.minAreaSqm;
  if (criteria.maxAreaSqm != null) compiled.maxAreaSqm = criteria.maxAreaSqm;
  if (criteria.minRooms != null) compiled.minRooms = criteria.minRooms;
  if (criteria.maxRooms != null) compiled.maxRooms = criteria.maxRooms;
  if (criteria.minScore != null) compiled.minScore = criteria.minScore;

  if (criteria.requiredKeywords?.length) {
    compiled.requiredKeywords = criteria.requiredKeywords
      .map(k => k.trim().toLowerCase()).filter(Boolean);
  }

  if (criteria.excludedKeywords?.length) {
    compiled.excludedKeywords = criteria.excludedKeywords
      .map(k => k.trim().toLowerCase()).filter(Boolean);
  }

  return compiled;
}
