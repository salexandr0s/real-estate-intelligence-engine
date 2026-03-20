import { VIENNA_DISTRICTS } from '@rei/contracts';

// ── Pre-built lookup maps ──────────────────────────────────────────────────

/** Postal code to district number */
const postalToDistrict = new Map<string, number>();

/** Lowercase canonical name to district number */
const nameToDistrict = new Map<string, number>();

/** Lowercase alias to district number */
const aliasToDistrict = new Map<string, number>();

/** District number to canonical name */
const numberToName = new Map<number, string>();

// Build all lookup maps at module load
for (const d of VIENNA_DISTRICTS) {
  postalToDistrict.set(d.postalCode, d.districtNo);
  numberToName.set(d.districtNo, d.name);
  nameToDistrict.set(d.name.toLowerCase(), d.districtNo);
  nameToDistrict.set(normalizeForLookup(d.name), d.districtNo);
  for (const alias of d.aliases) {
    aliasToDistrict.set(alias.toLowerCase(), d.districtNo);
    aliasToDistrict.set(normalizeForLookup(alias), d.districtNo);
  }
}

// ── Helper: normalize for lookup ───────────────────────────────────────────

/**
 * Normalizes text for district lookup: lowercases, replaces umlauts with
 * ASCII equivalents, removes diacritics.
 */
function normalizeForLookup(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\w\s\-.,]/g, '')
    .trim();
}

// ── Public functions ───────────────────────────────────────────────────────

/**
 * Infers district number from a Vienna postal code (1010-1230).
 * Only infers when the postal code follows the standard Vienna pattern:
 * 4 digits, 10xx format, ends in 0.
 */
export function postalCodeToDistrict(postalCode: string | null | undefined): number | null {
  if (postalCode == null) return null;

  const trimmed = postalCode.trim();
  if (trimmed.length !== 4) return null;

  const num = parseInt(trimmed, 10);
  if (!Number.isFinite(num)) return null;

  // Must be between 1010 and 1230
  if (num < 1010 || num > 1230) return null;

  // Must end in 0 (standard Vienna district postal codes)
  if (num % 10 !== 0) return null;

  // District = middle two digits (effectively (num - 1000) / 10)
  const districtNo = Math.floor((num - 1000) / 10);
  if (districtNo < 1 || districtNo > 23) return null;

  return postalToDistrict.has(trimmed) ? districtNo : null;
}

/**
 * Matches a district name string against canonical names and aliases.
 * Case-insensitive, umlaut-tolerant.
 */
export function districtNameToNumber(name: string | null | undefined): number | null {
  if (name == null) return null;

  const trimmed = name.trim();
  if (trimmed === '') return null;

  // Try direct lowercase match against canonical names
  const directMatch = nameToDistrict.get(trimmed.toLowerCase());
  if (directMatch != null) return directMatch;

  // Try normalized (umlaut-replaced) match
  const normalized = normalizeForLookup(trimmed);
  const normalizedMatch = nameToDistrict.get(normalized);
  if (normalizedMatch != null) return normalizedMatch;

  // Try alias match
  const aliasMatch = aliasToDistrict.get(trimmed.toLowerCase());
  if (aliasMatch != null) return aliasMatch;

  const aliasNormalized = aliasToDistrict.get(normalized);
  if (aliasNormalized != null) return aliasNormalized;

  return null;
}

/**
 * Extracts "N. Bezirk" pattern from free text.
 * Matches patterns like "2. Bezirk", "10. Bezirk", "3. bez".
 */
export function districtTextToNumber(text: string | null | undefined): number | null {
  if (text == null) return null;

  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Pattern: "N. Bezirk" or "N. Bez" or "N.Bezirk"
  const bezirkMatch = trimmed.match(/\b(\d{1,2})\s*\.?\s*bez(?:irk)?\b/i);
  if (bezirkMatch?.[1] != null) {
    const num = parseInt(bezirkMatch[1], 10);
    if (num >= 1 && num <= 23) return num;
  }

  // Pattern: "Wien N" or "Vienna N" where N is 1-23
  const wienMatch = trimmed.match(/\b(?:wien|vienna)\s+(\d{1,2})\b/i);
  if (wienMatch?.[1] != null) {
    const num = parseInt(wienMatch[1], 10);
    if (num >= 1 && num <= 23) return num;
  }

  return null;
}

/**
 * Returns the canonical district name for a district number.
 */
export function districtNumberToName(districtNo: number): string | null {
  return numberToName.get(districtNo) ?? null;
}

// ── Resolve District (composite) ───────────────────────────────────────────

interface DistrictInputs {
  postalCode?: string | null;
  districtRaw?: string | null;
  addressRaw?: string | null;
  cityRaw?: string | null;
}

interface DistrictResolution {
  districtNo: number | null;
  districtName: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  warnings: string[];
}

/**
 * Resolves Vienna district from multiple input signals using precedence rules:
 * 1. Explicit district number from districtRaw or addressRaw text
 * 2. District name alias match from districtRaw
 * 3. Postal code inference (only for standard Vienna codes)
 * 4. Weak text inference from addressRaw
 *
 * Contradictions generate warnings.
 */
export function resolveDistrict(inputs: DistrictInputs): DistrictResolution {
  const warnings: string[] = [];
  const candidates: Array<{ districtNo: number; source: string; confidence: 'high' | 'medium' | 'low' }> = [];

  // Check if city suggests Vienna
  const isVienna = isViennaCity(inputs.cityRaw);

  // 1. Explicit district number from districtRaw
  if (inputs.districtRaw != null) {
    // Try as a plain number
    const plainNum = parseInt(inputs.districtRaw.trim(), 10);
    if (Number.isFinite(plainNum) && plainNum >= 1 && plainNum <= 23) {
      candidates.push({ districtNo: plainNum, source: 'district_raw_number', confidence: 'high' });
    } else {
      // Try as district text pattern
      const textNum = districtTextToNumber(inputs.districtRaw);
      if (textNum != null) {
        candidates.push({ districtNo: textNum, source: 'district_raw_text', confidence: 'high' });
      }

      // Try as district name
      const nameNum = districtNameToNumber(inputs.districtRaw);
      if (nameNum != null) {
        candidates.push({ districtNo: nameNum, source: 'district_raw_name', confidence: 'high' });
      }
    }
  }

  // 2. District from address text
  if (inputs.addressRaw != null) {
    const addressDistrict = districtTextToNumber(inputs.addressRaw);
    if (addressDistrict != null) {
      candidates.push({ districtNo: addressDistrict, source: 'address_text', confidence: 'high' });
    }

    const addressName = districtNameToNumber(inputs.addressRaw);
    if (addressName != null) {
      candidates.push({ districtNo: addressName, source: 'address_name', confidence: 'medium' });
    }
  }

  // 3. Postal code inference
  if (inputs.postalCode != null && (isVienna || inputs.cityRaw == null)) {
    const postalDistrict = postalCodeToDistrict(inputs.postalCode);
    if (postalDistrict != null) {
      candidates.push({ districtNo: postalDistrict, source: 'postal_code', confidence: 'medium' });
    }
  }

  // No candidates found
  if (candidates.length === 0) {
    return { districtNo: null, districtName: null, confidence: 'none', warnings };
  }

  // Check for contradictions among high-confidence candidates
  const highConfidence = candidates.filter(c => c.confidence === 'high');
  const uniqueHighDistricts = new Set(highConfidence.map(c => c.districtNo));

  if (uniqueHighDistricts.size > 1) {
    warnings.push(
      `district_conflict: high-confidence sources disagree: ${highConfidence.map(c => `${c.source}=${c.districtNo}`).join(', ')}`
    );
  }

  // Check for contradiction between high and medium confidence
  const allDistricts = new Set(candidates.map(c => c.districtNo));
  if (allDistricts.size > 1) {
    const sources = candidates.map(c => `${c.source}=${c.districtNo}`).join(', ');
    warnings.push(`district_conflict_multi_source: ${sources}`);
  }

  // Use highest-confidence result (first high, then medium, then low)
  // Among same confidence, prefer explicit district over postal code
  const prioritized = candidates.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    return confOrder[a.confidence] - confOrder[b.confidence];
  });

  const best = prioritized[0];
  if (best == null) {
    return { districtNo: null, districtName: null, confidence: 'none', warnings };
  }

  const districtName = districtNumberToName(best.districtNo);

  return {
    districtNo: best.districtNo,
    districtName,
    confidence: best.confidence,
    warnings,
  };
}

/**
 * Checks if a city string indicates Vienna.
 */
function isViennaCity(city: string | null | undefined): boolean {
  if (city == null) return false;
  const normalized = city.trim().toLowerCase();
  return normalized === 'wien' || normalized === 'vienna' || normalized === 'wein';
}
