import type { NormalizationWarning } from '@rei/contracts';

// ── Price Parsing ──────────────────────────────────────────────────────────

const PRICE_NOT_NUMERIC_PATTERNS = [
  /preis\s+auf\s+anfrage/i,
  /auf\s+anfrage/i,
  /verhandlungsbasis/i,
  /vb/i,
  /n\.?\s*a\.?/i,
  /kontakt/i,
];

/**
 * Parses a raw price string into integer EUR cents.
 * Handles formats: "€ 299.000", "299000", "299.000,00", "€299,000.00"
 * Returns null for non-numeric price indicators like "Preis auf Anfrage".
 */
export function parseEurPrice(raw: string | number | null | undefined): {
  value: number | null;
  warning: NormalizationWarning | null;
} {
  if (raw == null) {
    return { value: null, warning: null };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      return {
        value: null,
        warning: {
          field: 'price',
          code: 'price_invalid_number',
          message: `Invalid numeric price: ${raw}`,
          rawValue: raw,
        },
      };
    }
    // If the number is likely already in cents (very large), keep as-is.
    // If it looks like euros (has decimals with 2 places or is reasonable), convert to cents.
    // Heuristic: if value > 100_000_000 cents = 1M EUR, assume it's cents already.
    const cents = raw > 100_000_000 ? raw : Math.round(raw * 100);
    return { value: cents, warning: null };
  }

  const text = raw.trim();

  if (text === '') {
    return { value: null, warning: null };
  }

  // Check for non-numeric price patterns
  for (const pattern of PRICE_NOT_NUMERIC_PATTERNS) {
    if (pattern.test(text)) {
      return {
        value: null,
        warning: {
          field: 'price',
          code: 'price_not_numeric',
          message: `Price is not numeric: "${text}"`,
          rawValue: raw,
        },
      };
    }
  }

  // Remove currency symbols and whitespace
  let cleaned = text.replace(/[€$\s]/g, '');

  // Determine decimal separator:
  // German format: 299.000,00 or 299.000 (dots as thousands, comma as decimal)
  // English format: 299,000.00 (commas as thousands, dot as decimal)
  // Plain: 299000

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot && lastComma !== -1) {
    // German format: comma is decimal separator
    // "299.000,00" -> remove dots, replace comma with dot
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastDot !== -1) {
    // Could be English decimal or German thousands separator
    const afterDot = cleaned.substring(lastDot + 1);
    if (afterDot.length === 3 && lastComma === -1) {
      // "299.000" -> German thousands, no decimal
      cleaned = cleaned.replace(/\./g, '');
    } else {
      // "299,000.00" -> English format, remove commas
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    // Only commas: check if it looks like a decimal
    const afterComma = cleaned.substring(lastComma + 1);
    if (afterComma.length <= 2) {
      // "299000,50" -> decimal comma
      cleaned = cleaned.replace(',', '.');
    } else {
      // "299,000" -> thousands separator
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  // Remove any remaining non-numeric characters except dot and minus
  cleaned = cleaned.replace(/[^\d.\-]/g, '');

  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      value: null,
      warning: {
        field: 'price',
        code: 'price_parse_failed',
        message: `Could not parse price: "${text}"`,
        rawValue: raw,
      },
    };
  }

  // Convert euros to cents
  const cents = Math.round(parsed * 100);
  return { value: cents, warning: null };
}

// ── Area Parsing ───────────────────────────────────────────────────────────

/**
 * Parses a raw area string into decimal square meters.
 * Handles: "58 m²", "58,4 m2", "58.4", "58,4"
 */
export function parseSqm(raw: string | number | null | undefined): {
  value: number | null;
  warning: NormalizationWarning | null;
} {
  if (raw == null) {
    return { value: null, warning: null };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return {
        value: null,
        warning: {
          field: 'area',
          code: 'area_invalid_number',
          message: `Invalid numeric area: ${raw}`,
          rawValue: raw,
        },
      };
    }
    return { value: Math.round(raw * 100) / 100, warning: null };
  }

  const text = raw.trim();
  if (text === '') {
    return { value: null, warning: null };
  }

  // Remove unit suffixes
  let cleaned = text.replace(/m[²2]?\s*$/i, '').trim();

  // Handle comma as decimal separator
  cleaned = cleaned.replace(',', '.');

  // Remove any remaining non-numeric chars except dot and minus
  cleaned = cleaned.replace(/[^\d.\-]/g, '');

  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      value: null,
      warning: {
        field: 'area',
        code: 'area_parse_failed',
        message: `Could not parse area: "${text}"`,
        rawValue: raw,
      },
    };
  }

  return { value: Math.round(parsed * 100) / 100, warning: null };
}

// ── Rooms Parsing ──────────────────────────────────────────────────────────

/**
 * Parses a raw rooms string into a decimal with 1 fractional digit.
 * Handles: "3 Zimmer", "2,5", "3.0", "2.5 Rooms"
 */
export function parseRooms(raw: string | number | null | undefined): {
  value: number | null;
  warning: NormalizationWarning | null;
} {
  if (raw == null) {
    return { value: null, warning: null };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return {
        value: null,
        warning: {
          field: 'rooms',
          code: 'rooms_invalid_number',
          message: `Invalid numeric rooms: ${raw}`,
          rawValue: raw,
        },
      };
    }
    return { value: Math.round(raw * 10) / 10, warning: null };
  }

  const text = raw.trim();
  if (text === '') {
    return { value: null, warning: null };
  }

  // Remove "Zimmer", "Rooms", "Raum" etc.
  let cleaned = text.replace(/\s*(zimmer|rooms?|räume?|raum)\s*/gi, '').trim();

  // Handle comma as decimal separator
  cleaned = cleaned.replace(',', '.');

  // Remove any remaining non-numeric chars except dot
  cleaned = cleaned.replace(/[^\d.]/g, '');

  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      value: null,
      warning: {
        field: 'rooms',
        code: 'rooms_parse_failed',
        message: `Could not parse rooms: "${text}"`,
        rawValue: raw,
      },
    };
  }

  return { value: Math.round(parsed * 10) / 10, warning: null };
}

// ── Boolean Parsing ────────────────────────────────────────────────────────

const TRUE_PATTERNS = ['ja', 'yes', 'vorhanden', 'mit', 'true', '1', 'inkl', 'inklusive', 'verfügbar'];
const FALSE_PATTERNS = ['nein', 'no', 'ohne', 'false', '0', 'nicht vorhanden', 'nicht verfügbar'];

/**
 * Parses German/English boolean text into true/false/null.
 * "ja"/"yes"/"vorhanden"/"mit" -> true
 * "nein"/"ohne" -> false
 * else -> null (never invent false from absence)
 */
export function parseBoolean(raw: string | boolean | null | undefined): boolean | null {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw;

  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return null;

  for (const pat of TRUE_PATTERNS) {
    if (normalized === pat || normalized.startsWith(pat)) return true;
  }

  for (const pat of FALSE_PATTERNS) {
    if (normalized === pat || normalized.startsWith(pat)) return false;
  }

  return null;
}

// ── Year Parsing ───────────────────────────────────────────────────────────

/**
 * Parses and validates a year (1800-2100).
 */
export function parseYear(raw: string | number | null | undefined): {
  value: number | null;
  warning: NormalizationWarning | null;
} {
  if (raw == null) {
    return { value: null, warning: null };
  }

  let year: number;
  if (typeof raw === 'number') {
    year = raw;
  } else {
    const text = raw.trim().replace(/[^\d]/g, '');
    year = parseInt(text, 10);
  }

  if (!Number.isFinite(year) || year < 1800 || year > 2100) {
    return {
      value: null,
      warning: {
        field: 'yearBuilt',
        code: 'year_out_of_range',
        message: `Year out of valid range (1800-2100): ${raw}`,
        rawValue: raw,
      },
    };
  }

  return { value: year, warning: null };
}

// ── Floor Parsing ──────────────────────────────────────────────────────────

const _FLOOR_PATTERNS: Array<{ pattern: RegExp; floor: number }> = [
  { pattern: /\b(?:ug|untergeschoss|keller|souterrain)\b/i, floor: -1 },
  { pattern: /\b(?:eg|erdgeschoss|parterre)\b/i, floor: 0 },
  { pattern: /\b(?:hg|hochparterre)\b/i, floor: 0 },
  { pattern: /\b(\d{1,2})\.\s*(?:og|obergeschoss|stock|etage|geschoss)\b/i, floor: -999 }, // placeholder, extract digit
  { pattern: /\b(?:dg|dachgeschoss)\b/i, floor: -998 }, // special: top floor marker
];

/**
 * Extracts floor number from text like "3. OG", "EG", "DG", "Souterrain".
 * DG returns a high number (99) as a marker for top floor.
 */
export function parseFloor(raw: string | number | null | undefined): {
  value: number | null;
  label: string | null;
  warning: NormalizationWarning | null;
} {
  if (raw == null) {
    return { value: null, label: null, warning: null };
  }

  if (typeof raw === 'number') {
    return { value: raw, label: String(raw), warning: null };
  }

  const text = raw.trim();
  if (text === '') {
    return { value: null, label: null, warning: null };
  }

  // Try numbered floor pattern first: "3. OG", "1. Stock"
  const numberedMatch = text.match(/(\d{1,2})\s*\.?\s*(?:og|obergeschoss|stock|etage|geschoss)/i);
  if (numberedMatch?.[1] != null) {
    const floorNum = parseInt(numberedMatch[1], 10);
    return { value: floorNum, label: text, warning: null };
  }

  // Try named patterns
  if (/\b(?:ug|untergeschoss|keller|souterrain)\b/i.test(text)) {
    return { value: -1, label: text, warning: null };
  }
  if (/\b(?:eg|erdgeschoss|parterre|hochparterre|hg)\b/i.test(text)) {
    return { value: 0, label: text, warning: null };
  }
  if (/\b(?:dg|dachgeschoss)\b/i.test(text)) {
    return { value: 99, label: text, warning: null };
  }

  // Try plain number
  const plainNum = parseInt(text.replace(/[^\d\-]/g, ''), 10);
  if (Number.isFinite(plainNum)) {
    return { value: plainNum, label: text, warning: null };
  }

  return {
    value: null,
    label: text,
    warning: {
      field: 'floor',
      code: 'floor_unparsed',
      message: `Could not parse floor from: "${text}"`,
      rawValue: raw,
    },
  };
}

// ── Whitespace Normalization ───────────────────────────────────────────────

/**
 * Unicode-normalizes, trims, and collapses whitespace in text.
 */
export function normalizeWhitespace(text: string | null | undefined): string | null {
  if (text == null) return null;
  const normalized = text.normalize('NFC').trim().replace(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}
