/**
 * Vienna district normalization tests.
 * Tests postal code inference, name matching, and contradiction handling.
 */
import { describe, it, expect } from 'vitest';

// ── Inline Vienna districts for standalone testing ──────────────────────────

interface ViennaDistrict {
  readonly districtNo: number;
  readonly name: string;
  readonly postalCode: string;
  readonly aliases: readonly string[];
}

const VIENNA_DISTRICTS: readonly ViennaDistrict[] = [
  { districtNo: 1, name: 'Innere Stadt', postalCode: '1010', aliases: ['1. bezirk', 'innenstadt'] },
  { districtNo: 2, name: 'Leopoldstadt', postalCode: '1020', aliases: ['2. bezirk'] },
  { districtNo: 3, name: 'Landstraße', postalCode: '1030', aliases: ['landstrasse', '3. bezirk'] },
  { districtNo: 4, name: 'Wieden', postalCode: '1040', aliases: ['4. bezirk'] },
  { districtNo: 5, name: 'Margareten', postalCode: '1050', aliases: ['5. bezirk'] },
  { districtNo: 6, name: 'Mariahilf', postalCode: '1060', aliases: ['6. bezirk'] },
  { districtNo: 7, name: 'Neubau', postalCode: '1070', aliases: ['7. bezirk'] },
  { districtNo: 8, name: 'Josefstadt', postalCode: '1080', aliases: ['8. bezirk'] },
  { districtNo: 9, name: 'Alsergrund', postalCode: '1090', aliases: ['9. bezirk'] },
  { districtNo: 10, name: 'Favoriten', postalCode: '1100', aliases: ['10. bezirk'] },
  { districtNo: 11, name: 'Simmering', postalCode: '1110', aliases: ['11. bezirk'] },
  { districtNo: 12, name: 'Meidling', postalCode: '1120', aliases: ['12. bezirk'] },
  { districtNo: 13, name: 'Hietzing', postalCode: '1130', aliases: ['13. bezirk'] },
  { districtNo: 14, name: 'Penzing', postalCode: '1140', aliases: ['14. bezirk'] },
  { districtNo: 15, name: 'Rudolfsheim-Fünfhaus', postalCode: '1150', aliases: ['rudolfsheim fuenfhaus', '15. bezirk'] },
  { districtNo: 16, name: 'Ottakring', postalCode: '1160', aliases: ['16. bezirk'] },
  { districtNo: 17, name: 'Hernals', postalCode: '1170', aliases: ['17. bezirk'] },
  { districtNo: 18, name: 'Währing', postalCode: '1180', aliases: ['waehring', '18. bezirk'] },
  { districtNo: 19, name: 'Döbling', postalCode: '1190', aliases: ['doebling', '19. bezirk'] },
  { districtNo: 20, name: 'Brigittenau', postalCode: '1200', aliases: ['20. bezirk'] },
  { districtNo: 21, name: 'Floridsdorf', postalCode: '1210', aliases: ['21. bezirk'] },
  { districtNo: 22, name: 'Donaustadt', postalCode: '1220', aliases: ['22. bezirk'] },
  { districtNo: 23, name: 'Liesing', postalCode: '1230', aliases: ['23. bezirk'] },
];

// ── Inline district lookup functions for standalone testing ─────────────────

const POSTAL_CODE_MAP = new Map<string, number>();
const DISTRICT_NAME_MAP = new Map<string, number>();

for (const d of VIENNA_DISTRICTS) {
  POSTAL_CODE_MAP.set(d.postalCode, d.districtNo);
  DISTRICT_NAME_MAP.set(d.name.toLowerCase(), d.districtNo);
  for (const alias of d.aliases) {
    DISTRICT_NAME_MAP.set(alias.toLowerCase(), d.districtNo);
  }
}

function postalCodeToDistrict(postalCode: string | null): number | null {
  if (!postalCode) return null;
  const cleaned = postalCode.trim();
  if (!/^\d{4}$/.test(cleaned)) return null;
  if (!cleaned.endsWith('0')) return null;
  const code = parseInt(cleaned, 10);
  if (code < 1010 || code > 1230) return null;
  return POSTAL_CODE_MAP.get(cleaned) ?? null;
}

function districtNameToNumber(name: string | null): number | null {
  if (!name) return null;
  const normalized = name.toLowerCase().trim()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  // Also try original (for entries with umlauts in the map)
  return DISTRICT_NAME_MAP.get(name.toLowerCase().trim())
    ?? DISTRICT_NAME_MAP.get(normalized)
    ?? null;
}

function districtTextToNumber(text: string | null): number | null {
  if (!text) return null;
  // Match patterns like "2. Bezirk", "3.Bezirk", "20. bezirk"
  const match = text.match(/(\d{1,2})\.\s*bezirk/i);
  if (match?.[1]) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 23) return num;
  }
  return null;
}

interface DistrictResolveInput {
  postalCode?: string | null;
  districtRaw?: string | null;
  addressRaw?: string | null;
  cityRaw?: string | null;
}

interface DistrictResolveResult {
  districtNo: number | null;
  districtName: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  warnings: string[];
}

function resolveDistrict(input: DistrictResolveInput): DistrictResolveResult {
  const warnings: string[] = [];
  const candidates: Array<{ no: number; source: string; confidence: 'high' | 'medium' | 'low' }> = [];

  // 1. District text pattern in address
  if (input.addressRaw) {
    const fromText = districtTextToNumber(input.addressRaw);
    if (fromText) candidates.push({ no: fromText, source: 'address_text', confidence: 'high' });
  }

  // 2. District name in districtRaw
  if (input.districtRaw) {
    const fromName = districtNameToNumber(input.districtRaw) ?? districtTextToNumber(input.districtRaw);
    if (fromName) candidates.push({ no: fromName, source: 'district_raw', confidence: 'high' });
  }

  // 3. Postal code inference
  if (input.postalCode) {
    const isVienna = !input.cityRaw || /wien|vienna/i.test(input.cityRaw);
    if (isVienna) {
      const fromPostal = postalCodeToDistrict(input.postalCode);
      if (fromPostal) candidates.push({ no: fromPostal, source: 'postal_code', confidence: 'medium' });
    }
  }

  if (candidates.length === 0) {
    return { districtNo: null, districtName: null, confidence: 'none', warnings: ['district_not_resolved'] };
  }

  // Check contradictions
  const uniqueDistricts = [...new Set(candidates.map(c => c.no))];
  if (uniqueDistricts.length > 1) {
    warnings.push('district_conflict');
    // Prefer highest confidence
    candidates.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.confidence] - order[b.confidence];
    });
  }

  const best = candidates[0]!;
  const district = VIENNA_DISTRICTS.find(d => d.districtNo === best.no);

  return {
    districtNo: best.no,
    districtName: district?.name ?? null,
    confidence: best.confidence,
    warnings,
  };
}

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
    expect(result.warnings).toContain('district_conflict');
    // Structured address (districtRaw) wins over postal inference
    expect(result.districtNo).toBe(2);
  });

  it('returns none for non-Vienna without clues', () => {
    const result = resolveDistrict({ postalCode: '4020', cityRaw: 'Linz' });
    expect(result.districtNo).toBe(null);
    expect(result.confidence).toBe('none');
  });
});
