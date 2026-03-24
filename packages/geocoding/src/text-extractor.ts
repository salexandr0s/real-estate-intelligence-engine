/**
 * NLP text extraction for geocoding signals from German listing text.
 *
 * Extracts:
 * - Street names (Margaretenstraße 45, Neubaugasse, etc.)
 * - U-Bahn station references (Nähe U3 Zieglergasse, nahe U-Bahn Karlsplatz)
 * - District references (7. Bezirk, Wien 3)
 */

import { findStation, isAmbiguousStationName } from './station-index.js';
import type { UbahnStation } from './data/ubahn-stations.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface StreetExtraction {
  streetName: string;
  houseNumber: string | null;
  fullAddress: string;
}

export interface StationExtraction {
  stationName: string;
  latitude: number;
  longitude: number;
}

export interface DistrictExtraction {
  districtNo: number;
}

export interface LocationSignals {
  streets: StreetExtraction[];
  stations: StationExtraction[];
  districts: DistrictExtraction[];
}

// ── Normalize ───────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Street Extraction ───────────────────────────────────────────────────────

/**
 * German street suffixes. Order matters — longer suffixes first to avoid
 * partial matches (e.g. "straße" before "ring").
 */
const STREET_SUFFIXES = [
  'promenade',
  'straße',
  'strasse',
  'gasse',
  'platz',
  'allee',
  'damm',
  'ufer',
  'zeile',
  'ring',
  'weg',
];

const STREET_SUFFIX_PATTERN = STREET_SUFFIXES.join('|');

/**
 * Match German street names with optional house number.
 * Captures:
 * - Group 1: Full street name (e.g. "Margaretenstraße")
 * - Group 2: House number (e.g. "45", "12a", "3/2")
 */
const STREET_REGEX = new RegExp(
  `([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\\-]*(?:${STREET_SUFFIX_PATTERN}))` +
    `(?=[\\s,;:.!?)\\]\\-]|$)` + // lookahead: suffix must end at word boundary (not "Landstraßer")
    `(?:\\s+(\\d+[\\da-zA-Z/\\-]*))?`,
  'gi',
);

/** Words that look like streets but aren't location-relevant. */
const STREET_BLACKLIST = new Set([
  'vorsorgewohnung', // investment apartment type
  'anlagewohnung', // investment apartment type
  'eigentumswohnung', // property type
  'mietwohnung', // rental type
  // Bare suffixes — prevent false positives from two-word streets like "Mariahilfer Straße"
  'straße',
  'strasse',
  'gasse',
  'platz',
  'allee',
  'ring',
  'damm',
  'ufer',
  'zeile',
  'promenade',
]);

/**
 * Extract street names from text.
 * Returns all unique streets found, ordered by position in text.
 */
export function extractStreetsFromText(text: string): StreetExtraction[] {
  const normalized = normalizeText(text);
  const results: StreetExtraction[] = [];
  const seen = new Set<string>();

  // Reset regex state
  STREET_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = STREET_REGEX.exec(normalized)) !== null) {
    const streetName = match[1]!;
    const houseNumber = match[2] ?? null;

    // Skip blacklisted words
    if (STREET_BLACKLIST.has(streetName.toLowerCase())) continue;

    // Skip very short matches (likely false positives like "Weg" alone)
    if (streetName.length < 5) continue;

    const key = streetName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const fullAddress = houseNumber ? `${streetName} ${houseNumber}` : streetName;
    results.push({ streetName, houseNumber, fullAddress });
  }

  return results;
}

// ── Station Extraction ──────────────────────────────────────────────────────

/**
 * U-Bahn context patterns that precede station names.
 * Matches: "U1", "U-Bahn", "U Bahn", "nächste U-Bahn:", "nahe U3", etc.
 */
const UBAHN_CONTEXT_REGEX = /(?:u-?bahn|u\s*[1-6])\s*(?:station|haltestelle)?\s*[:;,]?\s*/gi;

/**
 * Proximity context words that often precede station names.
 * "Nähe U3 Zieglergasse", "nahe U-Bahn Karlsplatz", "nächste U-Bahn: Pilgramgasse"
 */
const PROXIMITY_UBAHN_REGEX =
  /(?:n[äa]he|n[äa]chste[rn]?|bei[m]?|direkt\s+(?:bei|an|neben))\s+(?:(?:u-?bahn|u\s*[1-6])\s*(?:station|haltestelle)?\s*[:;,]?\s*)/gi;

/**
 * Extract U-Bahn station references from text.
 * Handles:
 * - Explicit context: "Nähe U3 Zieglergasse", "nahe U-Bahn Karlsplatz"
 * - U-line + station: "U6 Burggasse", "U3 Simmering"
 * - Direct station name (only for non-ambiguous names)
 */
export function extractStationFromText(text: string): StationExtraction | null {
  const normalized = normalizeText(text);

  // Strategy 1: "U-Bahn context + next word(s)" — look for station name after U-Bahn mention
  const contextMatch = tryExtractWithContext(normalized);
  if (contextMatch) return contextMatch;

  // Strategy 2: "U[1-6] StationName" pattern
  const uLineMatch = tryExtractULinePlusStation(normalized);
  if (uLineMatch) return uLineMatch;

  // Strategy 3: Direct non-ambiguous station name in text
  const directMatch = tryExtractDirectStation(normalized);
  if (directMatch) return directMatch;

  return null;
}

function tryExtractWithContext(text: string): StationExtraction | null {
  // Try proximity pattern first (more specific)
  PROXIMITY_UBAHN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PROXIMITY_UBAHN_REGEX.exec(text)) !== null) {
    const afterContext = text.slice(match.index + match[0].length);
    const station = matchStationInText(afterContext, true);
    if (station) return station;
  }

  // Try basic U-Bahn context
  UBAHN_CONTEXT_REGEX.lastIndex = 0;
  while ((match = UBAHN_CONTEXT_REGEX.exec(text)) !== null) {
    const afterContext = text.slice(match.index + match[0].length);
    const station = matchStationInText(afterContext, true);
    if (station) return station;
  }

  return null;
}

function tryExtractULinePlusStation(text: string): StationExtraction | null {
  // Pattern: U[1-6] followed by station name
  const uLineRegex = /\bu\s*([1-6])\s+([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s\-]{2,30})/gi;
  uLineRegex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = uLineRegex.exec(text)) !== null) {
    const candidate = match[2]!.trim();
    // Try matching the candidate as a station name (allow ambiguous since we have U-line context)
    const station = lookupStation(candidate, true);
    if (station) return station;
  }

  return null;
}

function tryExtractDirectStation(text: string): StationExtraction | null {
  // Only try non-ambiguous station names that appear as whole words
  // This is the lowest-confidence strategy
  const words = text.split(/[\s,;:!.()\[\]]+/);

  // Try multi-word station names first (2-3 words)
  for (let len = 3; len >= 1; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const candidate = words.slice(i, i + len).join(' ');
      if (candidate.length < 4) continue;

      const station = lookupStation(candidate, false);
      if (station) return station;
    }
  }

  return null;
}

/**
 * Try to match a station name from the beginning of a text fragment.
 * Used after stripping U-Bahn context.
 */
function matchStationInText(text: string, allowAmbiguous: boolean): StationExtraction | null {
  // Take first few words as candidate
  const words = text.split(/[\s,;:!.()\[\]]+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;

  // Try 3 words, then 2, then 1
  for (let len = Math.min(3, words.length); len >= 1; len--) {
    const candidate = words.slice(0, len).join(' ');
    const station = lookupStation(candidate, allowAmbiguous);
    if (station) return station;
  }

  return null;
}

function lookupStation(name: string, allowAmbiguous: boolean): StationExtraction | null {
  const station: UbahnStation | null = findStation(name);
  if (!station) return null;

  // If ambiguous, only match with U-Bahn context
  if (!allowAmbiguous && isAmbiguousStationName(name)) {
    return null;
  }

  return {
    stationName: station.name,
    latitude: station.lat,
    longitude: station.lon,
  };
}

// ── District Extraction ─────────────────────────────────────────────────────

/**
 * Extract district number from text.
 * Matches: "7. Bezirk", "10. Bez", "Wien 3", "Vienna 12"
 *
 * Reuses the same regex patterns as @immoradar/normalization's districtTextToNumber.
 */
export function extractDistrictFromText(text: string): DistrictExtraction | null {
  if (!text || text.trim().length === 0) return null;

  const normalized = normalizeText(text);

  // Pattern 1: "N. Bezirk" or "N. Bez"
  const bezirkMatch = normalized.match(/\b(\d{1,2})\s*\.?\s*bez(?:irk)?\b/i);
  if (bezirkMatch?.[1] != null) {
    const num = parseInt(bezirkMatch[1], 10);
    if (num >= 1 && num <= 23) return { districtNo: num };
  }

  // Pattern 2: "Wien N" or "Vienna N"
  const wienMatch = normalized.match(/\b(?:wien|vienna)\s+(\d{1,2})\b/i);
  if (wienMatch?.[1] != null) {
    const num = parseInt(wienMatch[1], 10);
    if (num >= 1 && num <= 23) return { districtNo: num };
  }

  // Pattern 3: "1XXX Wien" postal code pattern
  const postalMatch = normalized.match(/\b1(\d{2})0\b\s*(?:wien|vienna)/i);
  if (postalMatch?.[1] != null) {
    const num = parseInt(postalMatch[1], 10);
    if (num >= 1 && num <= 23) return { districtNo: num };
  }

  return null;
}

// ── Coordinator ─────────────────────────────────────────────────────────────

export interface TextExtractionInput {
  title: string | null;
  description: string | null;
  addressDisplay: string | null;
}

/**
 * Extract all location signals from listing text fields.
 * Processes title → addressDisplay → description (title first = highest priority).
 */
export function extractLocationSignals(input: TextExtractionInput): LocationSignals {
  const streets: StreetExtraction[] = [];
  const stations: StationExtraction[] = [];
  const districts: DistrictExtraction[] = [];

  const seenStreets = new Set<string>();
  const seenStations = new Set<string>();
  const seenDistricts = new Set<number>();

  // Process text fields in priority order
  const texts = [input.title, input.addressDisplay, input.description].filter(
    (t): t is string => t != null && t.trim().length > 0,
  );

  for (const text of texts) {
    // Streets
    for (const street of extractStreetsFromText(text)) {
      const key = street.streetName.toLowerCase();
      if (!seenStreets.has(key)) {
        seenStreets.add(key);
        streets.push(street);
      }
    }

    // Stations (only first match — highest priority text wins)
    if (stations.length === 0) {
      const station = extractStationFromText(text);
      if (station && !seenStations.has(station.stationName)) {
        seenStations.add(station.stationName);
        stations.push(station);
      }
    }

    // Districts
    const district = extractDistrictFromText(text);
    if (district && !seenDistricts.has(district.districtNo)) {
      seenDistricts.add(district.districtNo);
      districts.push(district);
    }
  }

  return { streets, stations, districts };
}
