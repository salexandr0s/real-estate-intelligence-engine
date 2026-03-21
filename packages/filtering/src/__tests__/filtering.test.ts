import { describe, it, expect } from 'vitest';
import { compileFilter, validateFilterCreate, validateFilterUpdate } from '../index.js';
import type { FilterCriteria, FilterCreateInput } from '@rei/contracts';

function makeInput(criteria: FilterCriteria = {}): FilterCreateInput {
  return {
    userId: 1,
    name: 'Test',
    filterKind: 'listing_search',
    criteria,
    alertFrequency: 'instant',
    alertChannels: ['in_app'],
  };
}

// ── compileFilter ───────────────────────────────────────────────────────────

describe('compileFilter', () => {
  it('deduplicates and sorts postal codes', () => {
    const result = compileFilter({ postalCodes: ['1030', '1020', '1030'] });
    expect(result.postalCodes).toEqual(['1020', '1030']);
  });

  it('omits empty property types array', () => {
    const result = compileFilter({ propertyTypes: [] });
    expect(result.propertyTypes).toBeUndefined();
  });

  it('omits undefined districts', () => {
    const result = compileFilter({});
    expect(result.districts).toBeUndefined();
  });

  it('passes through all sort options', () => {
    const sorts = ['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc'] as const;
    for (const s of sorts) {
      expect(compileFilter({ sortBy: s }).sortBy).toBe(s);
    }
  });

  it('converts minPriceEur to cents', () => {
    const result = compileFilter({ minPriceEur: 100000 });
    expect(result.minPriceCents).toBe(10000000);
  });

  it('handles decimal EUR to cents conversion', () => {
    const result = compileFilter({ maxPriceEur: 299999.99 });
    expect(result.maxPriceCents).toBe(29999999);
  });
});

// ── validateFilterCreate ────────────────────────────────────────────────────

describe('validateFilterCreate', () => {
  it('accepts fully valid filter', () => {
    const errors = validateFilterCreate(makeInput({
      operationType: 'sale',
      propertyTypes: ['apartment', 'house'],
      districts: [1, 2, 3],
      minPriceEur: 100000,
      maxPriceEur: 500000,
      minAreaSqm: 40,
      maxAreaSqm: 120,
      minRooms: 2,
      maxRooms: 5,
      minScore: 60,
      sortBy: 'price_asc',
    }));
    expect(errors).toEqual([]);
  });

  it('rejects invalid property types', () => {
    const errors = validateFilterCreate(makeInput({
      propertyTypes: ['mansion' as 'apartment'],
    }));
    expect(errors.some(e => e.field === 'propertyTypes')).toBe(true);
  });

  it('rejects minArea > maxArea', () => {
    const errors = validateFilterCreate(makeInput({
      minAreaSqm: 100,
      maxAreaSqm: 50,
    }));
    expect(errors.some(e => e.field === 'area')).toBe(true);
  });

  it('rejects missing name', () => {
    const errors = validateFilterCreate({ ...makeInput(), name: '' });
    expect(errors.some(e => e.field === 'name')).toBe(true);
  });

  it('rejects missing userId', () => {
    const errors = validateFilterCreate({ ...makeInput(), userId: 0 });
    expect(errors.some(e => e.field === 'userId')).toBe(true);
  });
});

// ── validateFilterUpdate ────────────────────────────────────────────────────

describe('validateFilterUpdate', () => {
  it('validates partial criteria', () => {
    const errors = validateFilterUpdate({ minScore: 50 });
    expect(errors).toEqual([]);
  });

  it('rejects invalid sortBy', () => {
    const errors = validateFilterUpdate({ sortBy: 'random' as 'newest' });
    expect(errors.some(e => e.field === 'sortBy')).toBe(true);
  });

  it('rejects negative maxPrice', () => {
    const errors = validateFilterUpdate({ maxPriceEur: -1 });
    expect(errors.some(e => e.field === 'maxPriceEur')).toBe(true);
  });
});
