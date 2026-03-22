/**
 * In-memory index for looking up U-Bahn stations by name.
 * Handles compound station names and marks ambiguous names
 * (stations that share names with Vienna districts).
 */

import { VIENNA_UBAHN_STATIONS, normalize, type UbahnStation } from './data/ubahn-stations.js';

export interface StationIndex {
  /** Normalized name → station lookup */
  byNormalizedName: Map<string, UbahnStation>;
  /** Names that are also Vienna district names — require U-Bahn context to match */
  ambiguousNames: Set<string>;
}

/**
 * District names that are also U-Bahn station names.
 * Values must be in normalized form (lowercase, umlauts replaced).
 * These only match when preceded by U-Bahn context words (U1-U6, U-Bahn, etc.).
 */
const DISTRICT_STATION_NAMES = new Set([
  'simmering',
  'floridsdorf',
  'ottakring',
  'hietzing',
  'meidling',
  'heiligenstadt',
  'erdberg',
  'stadlau',
  'leopoldau',
  'oberlaa',
]);

let cachedIndex: StationIndex | null = null;

/** Build or return the cached station index. */
export function getStationIndex(): StationIndex {
  if (cachedIndex) return cachedIndex;

  const byNormalizedName = new Map<string, UbahnStation>();

  for (const station of VIENNA_UBAHN_STATIONS) {
    // Index by primary normalized name
    byNormalizedName.set(station.normalizedName, station);

    // Index by alternate names
    for (const alt of station.alternateNames) {
      const normalizedAlt = normalize(alt);
      // Don't overwrite if already indexed (first wins)
      if (!byNormalizedName.has(normalizedAlt)) {
        byNormalizedName.set(normalizedAlt, station);
      }
    }
  }

  cachedIndex = {
    byNormalizedName,
    ambiguousNames: DISTRICT_STATION_NAMES,
  };

  return cachedIndex;
}

/** Look up a station by name (case/umlaut insensitive). */
export function findStation(name: string): UbahnStation | null {
  const index = getStationIndex();
  return index.byNormalizedName.get(normalize(name)) ?? null;
}

/** Check if a station name is ambiguous (also a district/locality name). */
export function isAmbiguousStationName(name: string): boolean {
  const index = getStationIndex();
  return index.ambiguousNames.has(normalize(name));
}
