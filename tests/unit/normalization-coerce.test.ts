/**
 * Normalization coercion tests.
 * Tests the field parsing utilities from @immoradar/normalization.
 * Imports from @immoradar/normalization — no inline re-implementations.
 */
import { describe, it, expect } from 'vitest';
import {
  parseEurPrice,
  parseSqm,
  parseRooms,
  parseBoolean,
  normalizeWhitespace,
} from '@immoradar/normalization';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('parseEurPrice', () => {
  it('parses standard integer price', () => {
    const result = parseEurPrice(299000);
    expect(result.value).toBe(29900000);
    expect(result.warning).toBeNull();
  });

  it('parses European format: 299.000', () => {
    const result = parseEurPrice('299.000');
    expect(result.value).toBe(29900000);
    expect(result.warning).toBeNull();
  });

  it('parses European format with cents: 299.000,00', () => {
    const result = parseEurPrice('299.000,00');
    expect(result.value).toBe(29900000);
    expect(result.warning).toBeNull();
  });

  it('parses with currency symbol: € 299.000', () => {
    const result = parseEurPrice('€ 299.000');
    expect(result.value).toBe(29900000);
    expect(result.warning).toBeNull();
  });

  it('parses plain number string: 299000', () => {
    const result = parseEurPrice('299000');
    expect(result.value).toBe(29900000);
    expect(result.warning).toBeNull();
  });

  it('returns null with warning for "Preis auf Anfrage"', () => {
    const result = parseEurPrice('Preis auf Anfrage');
    expect(result.value).toBeNull();
    expect(result.warning).not.toBeNull();
    expect(result.warning!.code).toBe('price_not_numeric');
  });

  it('returns null without warning for null input', () => {
    const result = parseEurPrice(null);
    expect(result.value).toBeNull();
    expect(result.warning).toBeNull();
  });

  it('returns null with warning for negative price', () => {
    const result = parseEurPrice(-100);
    expect(result.value).toBeNull();
    expect(result.warning).not.toBeNull();
  });
});

describe('parseSqm', () => {
  it('parses "58 m²"', () => {
    expect(parseSqm('58 m²').value).toBe(58);
  });

  it('parses "58.4 m²"', () => {
    expect(parseSqm('58.4 m²').value).toBe(58.4);
  });

  it('parses numeric input', () => {
    expect(parseSqm(58.4).value).toBe(58.4);
  });

  it('parses European decimal "58,4"', () => {
    expect(parseSqm('58,4').value).toBe(58.4);
  });

  it('returns null for null input', () => {
    const result = parseSqm(null);
    expect(result.value).toBeNull();
    expect(result.warning).toBeNull();
  });

  it('returns null with warning for zero area', () => {
    const result = parseSqm(0);
    expect(result.value).toBeNull();
    expect(result.warning).not.toBeNull();
  });

  it('rejects a million m² or more, as from a misread price or phone number', () => {
    expect(parseSqm('999999').value).toBe(999999);
    expect(parseSqm('1000000').value).toBeNull();
    expect(parseSqm('+43 1 000 00 00').warning?.code).toBe('area_parse_failed');
    expect(parseSqm(1_000_000).warning?.code).toBe('area_invalid_number');
  });

  it('reads dots that group thousands as separators, as in "1.866,52 m²"', () => {
    expect(parseSqm('1.866,52 m²').value).toBe(1866.52);
    expect(parseSqm('1.866').value).toBe(1866);
    expect(parseSqm('78.5').value).toBe(78.5);
    expect(parseSqm('120,5').value).toBe(120.5);
    expect(parseSqm('1866.52').value).toBe(1866.52);
  });

  it('ignores the dot of an abbreviation such as "ca."', () => {
    // Read as a decimal point, it made "ca. 85 m²" 0.85 m² and the price per m² 100 times too high.
    expect(parseSqm('ca. 85 m²').value).toBe(85);
    expect(parseSqm('ca. 1.866,52 m²').value).toBe(1866.52);
  });
});

describe('parseRooms', () => {
  it('parses "3 Zimmer"', () => {
    expect(parseRooms('3 Zimmer').value).toBe(3);
  });

  it('parses "2,5 Zimmer" (half room)', () => {
    expect(parseRooms('2,5 Zimmer').value).toBe(2.5);
  });

  it('parses numeric input', () => {
    expect(parseRooms(3).value).toBe(3);
  });

  it('returns null for null input', () => {
    const result = parseRooms(null);
    expect(result.value).toBeNull();
    expect(result.warning).toBeNull();
  });

  it('rejects more than 99 rooms, as from a misread price or phone number', () => {
    expect(parseRooms('99').value).toBe(99);
    expect(parseRooms('100').value).toBeNull();
    expect(parseRooms('0660 0000000').warning?.code).toBe('rooms_parse_failed');
    expect(parseRooms(120).warning?.code).toBe('rooms_invalid_number');
  });

  it('rejects a figure with thousands separators instead of reading its first group', () => {
    expect(parseRooms('1.866').value).toBeNull();
    expect(parseRooms('1.866,52').value).toBeNull();
    expect(parseRooms('3.5').value).toBe(3.5);
  });

  it('ignores the dot of an abbreviation such as "ca."', () => {
    expect(parseRooms('ca. 3 Zimmer').value).toBe(3);
  });
});

describe('parseBoolean', () => {
  it('parses "ja" as true', () => {
    expect(parseBoolean('ja')).toBe(true);
  });

  it('parses "vorhanden" as true', () => {
    expect(parseBoolean('vorhanden')).toBe(true);
  });

  it('parses "nein" as false', () => {
    expect(parseBoolean('nein')).toBe(false);
  });

  it('parses "ohne" as false', () => {
    expect(parseBoolean('ohne')).toBe(false);
  });

  it('returns null for unknown text', () => {
    expect(parseBoolean('maybe')).toBe(null);
  });

  it('returns null for null', () => {
    expect(parseBoolean(null)).toBe(null);
  });
});

describe('normalizeWhitespace', () => {
  it('collapses multiple spaces', () => {
    expect(normalizeWhitespace('  3-Zimmer   Eigentumswohnung ')).toBe('3-Zimmer Eigentumswohnung');
  });

  it('normalizes unicode', () => {
    const nfd = 'Straße'.normalize('NFD');
    expect(normalizeWhitespace(nfd)).toBe('Straße');
  });

  it('returns null for empty string', () => {
    expect(normalizeWhitespace('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeWhitespace(null)).toBeNull();
  });
});
