/**
 * Vienna district normalization tests.
 * Tests postal code inference, name matching, and contradiction handling.
 * Imports from @rei/normalization — no inline re-implementations.
 */
import { describe, it, expect } from 'vitest';
import {
  postalCodeToDistrict,
  districtNameToNumber,
  districtTextToNumber,
  resolveDistrict,
} from '@rei/normalization';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('postalCodeToDistrict', () => {
  it('maps 1020 to district 2', () => {
    expect(postalCodeToDistrict('1020')).toBe(2);
  });

  it('maps 1030 to district 3', () => {
    expect(postalCodeToDistrict('1030')).toBe(3);
  });

  it('maps 1190 to district 19', () => {
    expect(postalCodeToDistrict('1190')).toBe(19);
  });

  it('maps 1230 to district 23', () => {
    expect(postalCodeToDistrict('1230')).toBe(23);
  });

  it('returns null for non-Vienna postal code', () => {
    expect(postalCodeToDistrict('4020')).toBe(null);
  });

  it('returns null for non-standard Vienna code not ending in 0', () => {
    expect(postalCodeToDistrict('1025')).toBe(null);
  });

  it('returns null for null', () => {
    expect(postalCodeToDistrict(null)).toBe(null);
  });
});

describe('districtNameToNumber', () => {
  it('matches "Leopoldstadt"', () => {
    expect(districtNameToNumber('Leopoldstadt')).toBe(2);
  });

  it('matches "Landstraße"', () => {
    expect(districtNameToNumber('Landstraße')).toBe(3);
  });

  it('matches alias "Landstrasse" (without ß)', () => {
    expect(districtNameToNumber('Landstrasse')).toBe(3);
  });

  it('is case-insensitive', () => {
    expect(districtNameToNumber('LEOPOLDSTADT')).toBe(2);
  });

  it('returns null for unknown', () => {
    expect(districtNameToNumber('Atlantis')).toBe(null);
  });
});

describe('districtTextToNumber', () => {
  it('extracts from "2. Bezirk"', () => {
    expect(districtTextToNumber('2. Bezirk')).toBe(2);
  });

  it('extracts from "20. Bezirk, Wien"', () => {
    expect(districtTextToNumber('20. Bezirk, Wien')).toBe(20);
  });

  it('is case-insensitive', () => {
    expect(districtTextToNumber('3. bezirk')).toBe(3);
  });

  it('returns null for no match', () => {
    expect(districtTextToNumber('Wien Mitte')).toBe(null);
  });
});

describe('resolveDistrict', () => {
  it('resolves from postal code', () => {
    const result = resolveDistrict({ postalCode: '1020', cityRaw: 'Wien' });
    expect(result.districtNo).toBe(2);
    expect(result.districtName).toBe('Leopoldstadt');
  });

  it('resolves from district name', () => {
    const result = resolveDistrict({ districtRaw: 'Landstraße' });
    expect(result.districtNo).toBe(3);
    expect(result.confidence).toBe('high');
  });

  it('resolves from address text pattern', () => {
    const result = resolveDistrict({ addressRaw: '2. Bezirk, Wien' });
    expect(result.districtNo).toBe(2);
    expect(result.confidence).toBe('high');
  });

  it('detects contradiction between sources', () => {
    const result = resolveDistrict({
      postalCode: '1030',
      districtRaw: 'Leopoldstadt', // district 2 — contradicts postal 1030 (district 3)
      cityRaw: 'Wien',
    });
    // Should have a warning about conflicting districts
    expect(result.warnings.some(w => w.includes('district_conflict'))).toBe(true);
    // Structured address (districtRaw) wins over postal inference
    expect(result.districtNo).toBe(2);
  });

  it('returns none for non-Vienna without clues', () => {
    const result = resolveDistrict({ postalCode: '4020', cityRaw: 'Linz' });
    expect(result.districtNo).toBe(null);
    expect(result.confidence).toBe('none');
  });
});
