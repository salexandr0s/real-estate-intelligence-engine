import { describe, expect, it } from 'vitest';
import { compileFilter, matchesCompiledFilter } from '../index.js';

function makeListing(overrides: Partial<Parameters<typeof matchesCompiledFilter>[0]> = {}) {
  return {
    operationType: 'sale' as const,
    propertyType: 'apartment' as const,
    districtNo: 7,
    listPriceEurCents: 450_000_00,
    livingAreaSqm: 88,
    rooms: 3,
    currentScore: 84,
    title: 'Top sanierte Altbauwohnung',
    description: 'Ruhige Lage mit Garten und Balkon',
    ...overrides,
  };
}

describe('matchesCompiledFilter cross-source parity', () => {
  const filter = compileFilter({
    operationType: 'sale',
    propertyTypes: ['apartment'],
    districts: [7],
    minPriceEur: 400_000,
    maxPriceEur: 500_000,
    minAreaSqm: 80,
    maxAreaSqm: 95,
    minRooms: 3,
    maxRooms: 4,
    minScore: 80,
    requiredKeywords: ['garten'],
    excludedKeywords: ['baurecht'],
  });

  it('keeps willhaben and immoscout24 listings equivalent when the required keyword only appears in the description', () => {
    const willhaben = makeListing({
      title: 'Sanierte Eigentumswohnung in Neubau',
      description: 'Hofseitig mit Garten und Loggia',
    });
    const immoscout24 = makeListing({
      title: 'Sanierte Eigentumswohnung in Neubau',
      description: 'Hofseitig mit Garten und Loggia',
    });

    expect(matchesCompiledFilter(willhaben, filter)).toBe(true);
    expect(matchesCompiledFilter(immoscout24, filter)).toBe(true);
  });

  it('keeps both sources excluded when the negative keyword only appears in the description', () => {
    const willhaben = makeListing({
      description: 'Interessante Lage, aber Baurecht auf dem Grundstück',
    });
    const immoscout24 = makeListing({
      description: 'Interessante Lage, aber Baurecht auf dem Grundstück',
    });

    expect(matchesCompiledFilter(willhaben, filter)).toBe(false);
    expect(matchesCompiledFilter(immoscout24, filter)).toBe(false);
  });

  it('keeps both sources rejected when any structured predicate fails', () => {
    const willhaben = makeListing({ rooms: 2.5 });
    const immoscout24 = makeListing({ currentScore: 79 });

    expect(matchesCompiledFilter(willhaben, filter)).toBe(false);
    expect(matchesCompiledFilter(immoscout24, filter)).toBe(false);
  });
});
