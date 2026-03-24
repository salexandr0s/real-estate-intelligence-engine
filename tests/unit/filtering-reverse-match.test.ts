/**
 * Reverse-match keyword filtering tests.
 * Tests the pure `filterByKeywords()` function exported from user-filters
 * for unit testing without DB access.
 */
import { describe, it, expect } from 'vitest';
import { userFilters } from '@immoradar/db';
import type { UserFilterRow } from '@immoradar/contracts';

const { filterByKeywords } = userFilters;

// ── Helper: build a minimal UserFilterRow with keyword overrides ──────────

function makeFilterRow(overrides: Partial<UserFilterRow> = {}): UserFilterRow {
  return {
    id: 1,
    userId: 1,
    name: 'Test Filter',
    filterKind: 'listing_search',
    isActive: true,
    operationType: null,
    propertyTypes: [],
    districts: [],
    postalCodes: [],
    minPriceEurCents: null,
    maxPriceEurCents: null,
    minAreaSqm: null,
    maxAreaSqm: null,
    minRooms: null,
    maxRooms: null,
    requiredKeywords: [],
    excludedKeywords: [],
    minScore: null,
    sortBy: 'score_desc',
    alertFrequency: 'instant',
    alertChannels: ['in_app'],
    criteriaJson: {},
    lastEvaluatedAt: null,
    lastMatchAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('filterByKeywords', () => {
  it('matches when required keyword is in title', () => {
    const filter = makeFilterRow({ requiredKeywords: ['balkon'] });
    const result = filterByKeywords([filter], 'Schöne Wohnung mit Balkon', null);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(filter.id);
  });

  it('does not match when required keyword is missing', () => {
    const filter = makeFilterRow({ requiredKeywords: ['terrasse'] });
    const result = filterByKeywords([filter], 'Schöne Wohnung mit Balkon', null);
    expect(result).toHaveLength(0);
  });

  it('does not match when excluded keyword is in description', () => {
    const filter = makeFilterRow({ excludedKeywords: ['baurecht'] });
    const result = filterByKeywords(
      [filter],
      'Schöne Wohnung',
      'Grundstück mit Baurecht im 10. Bezirk',
    );
    expect(result).toHaveLength(0);
  });

  it('matches all when filter has no keywords', () => {
    const filter = makeFilterRow({ requiredKeywords: [], excludedKeywords: [] });
    const result = filterByKeywords([filter], 'Beliebige Wohnung', 'Beliebige Beschreibung');
    expect(result).toHaveLength(1);
  });

  it('requires all keywords when multiple are specified', () => {
    const filter = makeFilterRow({ requiredKeywords: ['balkon', 'renoviert'] });

    // Only one keyword present → no match
    const partial = filterByKeywords([filter], 'Wohnung mit Balkon', null);
    expect(partial).toHaveLength(0);

    // Both keywords present → match
    const full = filterByKeywords(
      [filter],
      'Renovierte Wohnung mit Balkon',
      'Frisch renoviert, schöner Balkon.',
    );
    expect(full).toHaveLength(1);
  });

  it('keyword matching is case-insensitive', () => {
    const filter = makeFilterRow({ requiredKeywords: ['balkon'] });
    const result = filterByKeywords([filter], 'BALKON im Wohnzimmer', null);
    expect(result).toHaveLength(1);
  });

  it('excluded keyword matching is case-insensitive', () => {
    const filter = makeFilterRow({ excludedKeywords: ['baurecht'] });
    const result = filterByKeywords([filter], 'BAURECHT Wohnung', null);
    expect(result).toHaveLength(0);
  });

  it('filters multiple rows correctly', () => {
    const filterA = makeFilterRow({ id: 1, requiredKeywords: ['balkon'] });
    const filterB = makeFilterRow({ id: 2, requiredKeywords: ['terrasse'] });
    const filterC = makeFilterRow({ id: 3, requiredKeywords: [] });

    const result = filterByKeywords([filterA, filterB, filterC], 'Wohnung mit Balkon', null);

    // filterA matches (balkon present), filterB does not (terrasse missing), filterC matches (no keywords)
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([1, 3]);
  });

  it('handles null title and description', () => {
    const filter = makeFilterRow({ requiredKeywords: [] });
    const result = filterByKeywords([filter], null, null);
    expect(result).toHaveLength(1);
  });

  it('excluded keyword in title prevents match', () => {
    const filter = makeFilterRow({ excludedKeywords: ['schimmel'] });
    const result = filterByKeywords([filter], 'Wohnung mit Schimmel', null);
    expect(result).toHaveLength(0);
  });

  it('combines required and excluded keywords', () => {
    const filter = makeFilterRow({
      requiredKeywords: ['balkon'],
      excludedKeywords: ['baurecht'],
    });

    // Has required, no excluded → match
    const good = filterByKeywords([filter], 'Wohnung mit Balkon', 'Schöne Lage');
    expect(good).toHaveLength(1);

    // Has required but also excluded → no match
    const bad = filterByKeywords([filter], 'Wohnung mit Balkon', 'Grundstück mit Baurecht');
    expect(bad).toHaveLength(0);

    // Missing required → no match regardless
    const missing = filterByKeywords([filter], 'Schöne Wohnung', 'Gute Lage');
    expect(missing).toHaveLength(0);
  });
});
