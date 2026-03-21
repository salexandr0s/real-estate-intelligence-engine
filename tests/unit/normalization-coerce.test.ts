/**
 * Normalization coercion tests.
 * Tests the field parsing utilities from @rei/normalization.
 * Imports from @rei/normalization — no inline re-implementations.
 */
import { describe, it, expect } from 'vitest';
import {
  parseEurPrice,
  parseSqm,
  parseRooms,
  parseBoolean,
  normalizeWhitespace,
} from '@rei/normalization';

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
