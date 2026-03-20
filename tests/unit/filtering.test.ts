/**
 * Filtering engine tests.
 * Tests filter compilation, validation, and SQL query generation patterns.
 */
import { describe, it, expect } from 'vitest';
import type { FilterCriteria, CompiledFilter } from '@rei/contracts';

// ── Inline filter compilation for standalone testing ────────────────────────

function compileFilter(criteria: FilterCriteria): CompiledFilter {
  const compiled: CompiledFilter = {
    sortBy: criteria.sortBy ?? 'score_desc',
  };

  if (criteria.operationType) {
    compiled.operationType = criteria.operationType;
  }

  if (criteria.propertyTypes && criteria.propertyTypes.length > 0) {
    compiled.propertyTypes = [...criteria.propertyTypes];
  }

  if (criteria.districts && criteria.districts.length > 0) {
    compiled.districts = [...new Set(criteria.districts)].sort((a, b) => a - b);
  }

  if (criteria.postalCodes && criteria.postalCodes.length > 0) {
    compiled.postalCodes = [...new Set(criteria.postalCodes)].sort();
  }

  if (criteria.minPriceEur != null) {
    compiled.minPriceCents = Math.round(criteria.minPriceEur * 100);
  }

  if (criteria.maxPriceEur != null) {
    compiled.maxPriceCents = Math.round(criteria.maxPriceEur * 100);
  }

  if (criteria.minAreaSqm != null) {
    compiled.minAreaSqm = criteria.minAreaSqm;
  }

  if (criteria.maxAreaSqm != null) {
    compiled.maxAreaSqm = criteria.maxAreaSqm;
  }

  if (criteria.minRooms != null) {
    compiled.minRooms = criteria.minRooms;
  }

  if (criteria.maxRooms != null) {
    compiled.maxRooms = criteria.maxRooms;
  }

  if (criteria.minScore != null) {
    compiled.minScore = criteria.minScore;
  }

  if (criteria.requiredKeywords && criteria.requiredKeywords.length > 0) {
    compiled.requiredKeywords = criteria.requiredKeywords
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);
  }

  if (criteria.excludedKeywords && criteria.excludedKeywords.length > 0) {
    compiled.excludedKeywords = criteria.excludedKeywords
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);
  }

  return compiled;
}

// ── Filter validation ───────────────────────────────────────────────────────

interface ValidationError {
  field: string;
  message: string;
}

function validateFilter(criteria: FilterCriteria): ValidationError[] {
  const errors: ValidationError[] = [];

  if (criteria.minPriceEur != null && criteria.maxPriceEur != null) {
    if (criteria.minPriceEur > criteria.maxPriceEur) {
      errors.push({ field: 'price', message: 'minPriceEur must be <= maxPriceEur' });
    }
  }

  if (criteria.minAreaSqm != null && criteria.maxAreaSqm != null) {
    if (criteria.minAreaSqm > criteria.maxAreaSqm) {
      errors.push({ field: 'area', message: 'minAreaSqm must be <= maxAreaSqm' });
    }
  }

  if (criteria.minRooms != null && criteria.maxRooms != null) {
    if (criteria.minRooms > criteria.maxRooms) {
      errors.push({ field: 'rooms', message: 'minRooms must be <= maxRooms' });
    }
  }

  if (criteria.districts) {
    for (const d of criteria.districts) {
      if (d < 1 || d > 23) {
        errors.push({ field: 'districts', message: `Invalid district: ${d}` });
      }
    }
  }

  const validPropertyTypes = ['apartment', 'house', 'land', 'commercial', 'parking', 'other'];
  if (criteria.propertyTypes) {
    for (const pt of criteria.propertyTypes) {
      if (!validPropertyTypes.includes(pt)) {
        errors.push({ field: 'propertyTypes', message: `Invalid property type: ${pt}` });
      }
    }
  }

  if (criteria.minPriceEur != null && criteria.minPriceEur < 0) {
    errors.push({ field: 'minPriceEur', message: 'Price must be non-negative' });
  }

  if (criteria.maxPriceEur != null && criteria.maxPriceEur < 0) {
    errors.push({ field: 'maxPriceEur', message: 'Price must be non-negative' });
  }

  if (criteria.minScore != null && (criteria.minScore < 0 || criteria.minScore > 100)) {
    errors.push({ field: 'minScore', message: 'Score must be between 0 and 100' });
  }

  return errors;
}

// ── Query builder (structure test) ──────────────────────────────────────────

function buildListingSearchParams(filter: CompiledFilter): unknown[] {
  return [
    filter.operationType ?? null,
    filter.propertyTypes ?? [],
    filter.districts ?? [],
    filter.minPriceCents ?? null,
    filter.maxPriceCents ?? null,
    filter.minAreaSqm ?? null,
    filter.maxAreaSqm ?? null,
    filter.minRooms ?? null,
    filter.maxRooms ?? null,
    filter.minScore ?? null,
  ];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('compileFilter', () => {
  it('converts EUR to cents', () => {
    const result = compileFilter({ maxPriceEur: 300000 });
    expect(result.maxPriceCents).toBe(30000000);
  });

  it('deduplicates and sorts districts', () => {
    const result = compileFilter({ districts: [3, 2, 3, 2] });
    expect(result.districts).toEqual([2, 3]);
  });

  it('trims and lowercases keywords', () => {
    const result = compileFilter({ excludedKeywords: [' Baurecht ', 'WOHNRECHT'] });
    expect(result.excludedKeywords).toEqual(['baurecht', 'wohnrecht']);
  });

  it('filters empty keywords', () => {
    const result = compileFilter({ requiredKeywords: ['altbau', '', '  '] });
    expect(result.requiredKeywords).toEqual(['altbau']);
  });

  it('defaults sortBy to score_desc', () => {
    const result = compileFilter({});
    expect(result.sortBy).toBe('score_desc');
  });

  it('preserves explicit sortBy', () => {
    const result = compileFilter({ sortBy: 'price_asc' });
    expect(result.sortBy).toBe('price_asc');
  });
});

describe('validateFilter', () => {
  it('accepts valid filter', () => {
    const errors = validateFilter({
      operationType: 'sale',
      propertyTypes: ['apartment'],
      districts: [2, 3],
      maxPriceEur: 300000,
      minAreaSqm: 50,
      minScore: 70,
    });
    expect(errors).toEqual([]);
  });

  it('rejects minPrice > maxPrice', () => {
    const errors = validateFilter({ minPriceEur: 400000, maxPriceEur: 300000 });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe('price');
  });

  it('rejects invalid district', () => {
    const errors = validateFilter({ districts: [0, 24] });
    expect(errors).toHaveLength(2);
  });

  it('rejects negative price', () => {
    const errors = validateFilter({ minPriceEur: -100 });
    expect(errors).toHaveLength(1);
  });

  it('rejects score out of range', () => {
    const errors = validateFilter({ minScore: 150 });
    expect(errors).toHaveLength(1);
  });

  it('accepts empty filter (no constraints)', () => {
    const errors = validateFilter({});
    expect(errors).toEqual([]);
  });
});

describe('buildListingSearchParams', () => {
  it('produces correct params for typical investor filter', () => {
    const compiled = compileFilter({
      operationType: 'sale',
      propertyTypes: ['apartment'],
      districts: [2, 3],
      maxPriceEur: 300000,
      minAreaSqm: 50,
      minScore: 70,
    });

    const params = buildListingSearchParams(compiled);
    expect(params[0]).toBe('sale');
    expect(params[1]).toEqual(['apartment']);
    expect(params[2]).toEqual([2, 3]);
    expect(params[3]).toBe(null); // no min price
    expect(params[4]).toBe(30000000); // max price in cents
    expect(params[5]).toBe(50); // min area
    expect(params[9]).toBe(70); // min score
  });

  it('produces null for empty filter', () => {
    const compiled = compileFilter({});
    const params = buildListingSearchParams(compiled);
    expect(params[0]).toBe(null);
    expect(params[1]).toEqual([]);
    expect(params[2]).toEqual([]);
  });
});
