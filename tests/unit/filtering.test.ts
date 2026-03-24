/**
 * Filtering engine tests.
 * Tests filter compilation and validation.
 * Imports from @immoradar/filtering — no inline re-implementations.
 */
import { describe, it, expect } from 'vitest';
import { compileFilter, validateFilterCreate, validateFilterUpdate } from '@immoradar/filtering';
import type { FilterCriteria, FilterCreateInput } from '@immoradar/contracts';

// ── Helper ──────────────────────────────────────────────────────────────────

function makeFilterCreateInput(criteria: FilterCriteria = {}): FilterCreateInput {
  return {
    userId: 1,
    name: 'Test Filter',
    filterKind: 'listing_search',
    criteria,
    alertFrequency: 'instant',
    alertChannels: ['in_app'],
  };
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

describe('validateFilterCreate', () => {
  it('accepts valid filter', () => {
    const errors = validateFilterCreate(
      makeFilterCreateInput({
        operationType: 'sale',
        propertyTypes: ['apartment'],
        districts: [2, 3],
        maxPriceEur: 300000,
        minAreaSqm: 50,
        minScore: 70,
      }),
    );
    expect(errors).toEqual([]);
  });

  it('rejects minPrice > maxPrice', () => {
    const errors = validateFilterCreate(
      makeFilterCreateInput({
        minPriceEur: 400000,
        maxPriceEur: 300000,
      }),
    );
    expect(errors.some((e) => e.field === 'price')).toBe(true);
  });

  it('rejects invalid district', () => {
    const errors = validateFilterCreate(
      makeFilterCreateInput({
        districts: [0, 24],
      }),
    );
    expect(errors.filter((e) => e.field === 'districts')).toHaveLength(2);
  });

  it('rejects negative price', () => {
    const errors = validateFilterCreate(
      makeFilterCreateInput({
        minPriceEur: -100,
      }),
    );
    expect(errors.some((e) => e.field === 'minPriceEur')).toBe(true);
  });

  it('rejects score out of range', () => {
    const errors = validateFilterCreate(
      makeFilterCreateInput({
        minScore: 150,
      }),
    );
    expect(errors.some((e) => e.field === 'minScore')).toBe(true);
  });

  it('accepts empty filter (no constraints)', () => {
    const errors = validateFilterCreate(makeFilterCreateInput());
    expect(errors).toEqual([]);
  });

  it('requires name', () => {
    const errors = validateFilterCreate({
      ...makeFilterCreateInput(),
      name: '',
    });
    expect(errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('requires userId', () => {
    const errors = validateFilterCreate({
      ...makeFilterCreateInput(),
      userId: 0,
    });
    expect(errors.some((e) => e.field === 'userId')).toBe(true);
  });
});

describe('validateFilterUpdate', () => {
  it('accepts valid partial criteria', () => {
    const errors = validateFilterUpdate({ maxPriceEur: 500000, minScore: 60 });
    expect(errors).toEqual([]);
  });

  it('rejects minRooms > maxRooms', () => {
    const errors = validateFilterUpdate({ minRooms: 5, maxRooms: 2 });
    expect(errors.some((e) => e.field === 'rooms')).toBe(true);
  });
});
