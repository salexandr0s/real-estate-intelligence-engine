import type { PropertyType } from '@immoradar/contracts';

// ── Property Type Mapping ──────────────────────────────────────────────────

interface PropertyTypeResult {
  propertyType: PropertyType;
  propertySubtype: string | null;
}

/**
 * Mapping from German property type strings to canonical PropertyType.
 * Keys are lowercase for case-insensitive matching.
 */
const PROPERTY_TYPE_MAP: ReadonlyMap<string, PropertyTypeResult> = new Map<
  string,
  PropertyTypeResult
>([
  // Apartment types
  ['eigentumswohnung', { propertyType: 'apartment', propertySubtype: null }],
  ['wohnung', { propertyType: 'apartment', propertySubtype: null }],
  ['apartment', { propertyType: 'apartment', propertySubtype: null }],
  ['mietwohnung', { propertyType: 'apartment', propertySubtype: null }],
  ['penthouse', { propertyType: 'apartment', propertySubtype: 'penthouse' }],
  ['maisonette', { propertyType: 'apartment', propertySubtype: 'maisonette' }],
  ['maisonettewohnung', { propertyType: 'apartment', propertySubtype: 'maisonette' }],
  ['dachgeschosswohnung', { propertyType: 'apartment', propertySubtype: 'dachgeschoss' }],
  ['dachgeschoss', { propertyType: 'apartment', propertySubtype: 'dachgeschoss' }],
  ['loft', { propertyType: 'apartment', propertySubtype: 'loft' }],
  ['altbauwohnung', { propertyType: 'apartment', propertySubtype: 'altbau' }],
  ['altbau', { propertyType: 'apartment', propertySubtype: 'altbau' }],
  ['neubau', { propertyType: 'apartment', propertySubtype: 'neubau' }],
  ['neubauwohnung', { propertyType: 'apartment', propertySubtype: 'neubau' }],
  ['garconniere', { propertyType: 'apartment', propertySubtype: 'garconniere' }],
  ['garçonnière', { propertyType: 'apartment', propertySubtype: 'garconniere' }],
  ['souterrainwohnung', { propertyType: 'apartment', propertySubtype: 'souterrain' }],
  ['erdgeschosswohnung', { propertyType: 'apartment', propertySubtype: 'erdgeschoss' }],
  ['vorsorgewohnung', { propertyType: 'apartment', propertySubtype: 'vorsorgewohnung' }],
  ['anlegerwohnung', { propertyType: 'apartment', propertySubtype: 'anlegerwohnung' }],

  // House types
  ['haus', { propertyType: 'house', propertySubtype: null }],
  ['einfamilienhaus', { propertyType: 'house', propertySubtype: 'einfamilienhaus' }],
  ['reihenhaus', { propertyType: 'house', propertySubtype: 'reihenhaus' }],
  ['villa', { propertyType: 'house', propertySubtype: 'villa' }],
  ['doppelhaushälfte', { propertyType: 'house', propertySubtype: 'doppelhaushaelfte' }],
  ['doppelhaushaelfte', { propertyType: 'house', propertySubtype: 'doppelhaushaelfte' }],
  ['bungalow', { propertyType: 'house', propertySubtype: 'bungalow' }],
  ['mehrfamilienhaus', { propertyType: 'house', propertySubtype: 'mehrfamilienhaus' }],
  ['zweifamilienhaus', { propertyType: 'house', propertySubtype: 'zweifamilienhaus' }],
  ['stadthaus', { propertyType: 'house', propertySubtype: 'stadthaus' }],
  ['landhaus', { propertyType: 'house', propertySubtype: 'landhaus' }],
  ['ferienhaus', { propertyType: 'house', propertySubtype: 'ferienhaus' }],

  // Land types
  ['grundstück', { propertyType: 'land', propertySubtype: null }],
  ['grundstueck', { propertyType: 'land', propertySubtype: null }],
  ['baugrund', { propertyType: 'land', propertySubtype: 'baugrund' }],
  ['baugrundstück', { propertyType: 'land', propertySubtype: 'baugrund' }],
  ['ackerland', { propertyType: 'land', propertySubtype: 'ackerland' }],
  ['wald', { propertyType: 'land', propertySubtype: 'wald' }],

  // Commercial types
  ['büro', { propertyType: 'commercial', propertySubtype: 'buero' }],
  ['buero', { propertyType: 'commercial', propertySubtype: 'buero' }],
  ['geschäftslokal', { propertyType: 'commercial', propertySubtype: 'geschaeftslokal' }],
  ['geschaeftslokal', { propertyType: 'commercial', propertySubtype: 'geschaeftslokal' }],
  ['praxis', { propertyType: 'commercial', propertySubtype: 'praxis' }],
  ['zinshaus', { propertyType: 'commercial', propertySubtype: 'zinshaus' }],
  ['gewerbe', { propertyType: 'commercial', propertySubtype: null }],
  ['gewerbeobjekt', { propertyType: 'commercial', propertySubtype: null }],
  ['gastro', { propertyType: 'commercial', propertySubtype: 'gastro' }],
  ['gastronomieobjekt', { propertyType: 'commercial', propertySubtype: 'gastro' }],
  ['lagerfläche', { propertyType: 'commercial', propertySubtype: 'lager' }],
  ['lagerflaeche', { propertyType: 'commercial', propertySubtype: 'lager' }],

  // Parking types
  ['garage', { propertyType: 'parking', propertySubtype: 'garage' }],
  ['stellplatz', { propertyType: 'parking', propertySubtype: 'stellplatz' }],
  ['tiefgarage', { propertyType: 'parking', propertySubtype: 'tiefgarage' }],
  ['parkplatz', { propertyType: 'parking', propertySubtype: 'parkplatz' }],
  ['garagenplatz', { propertyType: 'parking', propertySubtype: 'garagenplatz' }],
]);

/**
 * Normalizes a raw property type string to canonical PropertyType + subtype.
 * Case-insensitive, umlaut-tolerant matching.
 */
export function normalizePropertyType(raw: string | null | undefined): PropertyTypeResult | null {
  if (raw == null) return null;

  const normalized = normalizeUmlauts(raw.trim().toLowerCase());
  if (normalized === '') return null;

  // Direct match
  const direct = PROPERTY_TYPE_MAP.get(normalized);
  if (direct) return direct;

  // Try without common suffixes
  const withoutSuffix = normalized.replace(/wohnung$/, '');
  if (withoutSuffix !== normalized) {
    const suffixMatch = PROPERTY_TYPE_MAP.get(withoutSuffix);
    if (suffixMatch) return suffixMatch;
  }

  // Substring matching for compound types
  for (const [key, result] of PROPERTY_TYPE_MAP) {
    if (normalized.includes(key) && key.length >= 4) {
      return result;
    }
  }

  return null;
}

/**
 * Replaces German umlauts with ASCII equivalents for matching purposes.
 */
function normalizeUmlauts(text: string): string {
  return text
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue');
}

/**
 * Maps an operation type string to the canonical enum value.
 */
export function normalizeOperationType(raw: string | null | undefined): 'sale' | 'rent' | null {
  if (raw == null) return null;

  const normalized = raw.trim().toLowerCase();

  const salePatterns = ['sale', 'kauf', 'kaufen', 'eigentum', 'buy', 'purchase'];
  const rentPatterns = ['rent', 'miete', 'mieten', 'pacht'];

  for (const pat of salePatterns) {
    if (normalized.includes(pat)) return 'sale';
  }

  for (const pat of rentPatterns) {
    if (normalized.includes(pat)) return 'rent';
  }

  return null;
}
