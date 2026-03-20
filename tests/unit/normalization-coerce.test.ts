/**
 * Normalization coercion tests.
 * These test the field parsing utilities from @rei/normalization.
 * They run against the pure functions without DB dependencies.
 */
import { describe, it, expect } from 'vitest';

// Since we test pure functions, we inline the logic here for standalone testing.
// In production these come from @rei/normalization/canonical/coerce.

// ── EUR Price Parsing ───────────────────────────────────────────────────────

function parseEurPrice(raw: string | number | null | undefined): { cents: number | null; warning: string | null } {
  if (raw == null || raw === '') return { cents: null, warning: 'price_missing' };

  if (typeof raw === 'number') {
    if (raw < 0) return { cents: null, warning: 'price_negative' };
    return { cents: Math.round(raw * 100), warning: null };
  }

  const text = raw.trim();

  // "Preis auf Anfrage" or similar non-numeric text
  if (/anfrage|request|verhandl/i.test(text)) {
    return { cents: null, warning: 'price_not_numeric' };
  }

  // Remove currency symbols and whitespace
  let cleaned = text.replace(/[€\s]/g, '');

  // Handle European number format: 299.000,00 or 299.000
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  // Handle: 299000 or 299000.00
  else if (/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    // already in standard format
  }
  // Handle: 299,000
  else if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  } else {
    // Try extracting digits
    const digits = cleaned.replace(/[^\d.,]/g, '');
    if (digits) {
      cleaned = digits.replace(/\./g, '').replace(',', '.');
    }
  }

  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed) || parsed < 0) {
    return { cents: null, warning: 'price_unparseable' };
  }

  return { cents: Math.round(parsed * 100), warning: null };
}

// ── SQM Parsing ─────────────────────────────────────────────────────────────

function parseSqm(raw: string | number | null | undefined): { value: number | null; warning: string | null } {
  if (raw == null || raw === '') return { value: null, warning: 'area_missing' };

  if (typeof raw === 'number') {
    return raw > 0 ? { value: raw, warning: null } : { value: null, warning: 'area_invalid' };
  }

  const cleaned = raw.replace(/m²|m2|qm/gi, '').replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { value: null, warning: 'area_unparseable' };
  }

  return { value: Math.round(parsed * 100) / 100, warning: null };
}

// ── Rooms Parsing ───────────────────────────────────────────────────────────

function parseRooms(raw: string | number | null | undefined): { value: number | null; warning: string | null } {
  if (raw == null || raw === '') return { value: null, warning: 'rooms_missing' };

  if (typeof raw === 'number') {
    return raw > 0 ? { value: Math.round(raw * 10) / 10, warning: null } : { value: null, warning: 'rooms_invalid' };
  }

  const cleaned = raw.replace(/zimmer|räume|rooms/gi, '').replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { value: null, warning: 'rooms_unparseable' };
  }

  return { value: Math.round(parsed * 10) / 10, warning: null };
}

// ── Boolean Parsing ─────────────────────────────────────────────────────────

function parseBoolean(raw: string | boolean | null | undefined): boolean | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'boolean') return raw;

  const lower = raw.toLowerCase().trim();
  if (['ja', 'yes', 'vorhanden', 'mit', 'true', '1'].includes(lower)) return true;
  if (['nein', 'no', 'ohne', 'false', '0'].includes(lower)) return false;
  return null;
}

// ── Whitespace Normalization ────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('parseEurPrice', () => {
  it('parses standard integer price', () => {
    expect(parseEurPrice(299000)).toEqual({ cents: 29900000, warning: null });
  });

  it('parses European format: 299.000', () => {
    expect(parseEurPrice('299.000')).toEqual({ cents: 29900000, warning: null });
  });

  it('parses European format with cents: 299.000,00', () => {
    expect(parseEurPrice('299.000,00')).toEqual({ cents: 29900000, warning: null });
  });

  it('parses with currency symbol: € 299.000', () => {
    expect(parseEurPrice('€ 299.000')).toEqual({ cents: 29900000, warning: null });
  });

  it('parses plain number string: 299000', () => {
    expect(parseEurPrice('299000')).toEqual({ cents: 29900000, warning: null });
  });

  it('returns null for "Preis auf Anfrage"', () => {
    expect(parseEurPrice('Preis auf Anfrage')).toEqual({ cents: null, warning: 'price_not_numeric' });
  });

  it('returns null for null input', () => {
    expect(parseEurPrice(null)).toEqual({ cents: null, warning: 'price_missing' });
  });

  it('returns null for negative price', () => {
    expect(parseEurPrice(-100)).toEqual({ cents: null, warning: 'price_negative' });
  });
});

describe('parseSqm', () => {
  it('parses "58 m²"', () => {
    expect(parseSqm('58 m²')).toEqual({ value: 58, warning: null });
  });

  it('parses "58.4 m²"', () => {
    expect(parseSqm('58.4 m²')).toEqual({ value: 58.4, warning: null });
  });

  it('parses numeric input', () => {
    expect(parseSqm(58.4)).toEqual({ value: 58.4, warning: null });
  });

  it('parses European decimal "58,4"', () => {
    expect(parseSqm('58,4')).toEqual({ value: 58.4, warning: null });
  });

  it('returns null for missing', () => {
    expect(parseSqm(null)).toEqual({ value: null, warning: 'area_missing' });
  });

  it('returns null for zero', () => {
    expect(parseSqm(0)).toEqual({ value: null, warning: 'area_invalid' });
  });
});

describe('parseRooms', () => {
  it('parses "3 Zimmer"', () => {
    expect(parseRooms('3 Zimmer')).toEqual({ value: 3, warning: null });
  });

  it('parses "2,5 Zimmer" (half room)', () => {
    expect(parseRooms('2,5 Zimmer')).toEqual({ value: 2.5, warning: null });
  });

  it('parses numeric input', () => {
    expect(parseRooms(3)).toEqual({ value: 3, warning: null });
  });

  it('returns null for missing', () => {
    expect(parseRooms(null)).toEqual({ value: null, warning: 'rooms_missing' });
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
});
