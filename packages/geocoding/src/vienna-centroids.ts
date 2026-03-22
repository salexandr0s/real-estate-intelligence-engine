/**
 * Approximate geographic centroids for all 23 Vienna districts.
 * Used as fallback geocoding when street-level precision is unavailable.
 */

export interface Centroid {
  lat: number;
  lon: number;
}

export const VIENNA_DISTRICT_CENTROIDS: Record<number, Centroid> = {
  1: { lat: 48.2082, lon: 16.3669 }, // Innere Stadt
  2: { lat: 48.2167, lon: 16.3958 }, // Leopoldstadt
  3: { lat: 48.1986, lon: 16.3948 }, // Landstrasse
  4: { lat: 48.1922, lon: 16.37 }, // Wieden
  5: { lat: 48.187, lon: 16.3556 }, // Margareten
  6: { lat: 48.196, lon: 16.35 }, // Mariahilf
  7: { lat: 48.2028, lon: 16.3493 }, // Neubau
  8: { lat: 48.2105, lon: 16.351 }, // Josefstadt
  9: { lat: 48.2263, lon: 16.356 }, // Alsergrund
  10: { lat: 48.1625, lon: 16.3827 }, // Favoriten
  11: { lat: 48.174, lon: 16.418 }, // Simmering
  12: { lat: 48.175, lon: 16.331 }, // Meidling
  13: { lat: 48.177, lon: 16.288 }, // Hietzing
  14: { lat: 48.195, lon: 16.28 }, // Penzing
  15: { lat: 48.196, lon: 16.331 }, // Rudolfsheim-Fünfhaus
  16: { lat: 48.212, lon: 16.32 }, // Ottakring
  17: { lat: 48.228, lon: 16.326 }, // Hernals
  18: { lat: 48.233, lon: 16.338 }, // Währing
  19: { lat: 48.248, lon: 16.354 }, // Döbling
  20: { lat: 48.229, lon: 16.377 }, // Brigittenau
  21: { lat: 48.2564, lon: 16.3988 }, // Floridsdorf
  22: { lat: 48.235, lon: 16.46 }, // Donaustadt
  23: { lat: 48.145, lon: 16.3 }, // Liesing
};

/** Vienna city center as final fallback. */
export const VIENNA_CENTER: Centroid = { lat: 48.2082, lon: 16.3738 };

/**
 * Maps common Vienna postal codes to district numbers.
 * Each Vienna postal code is 1XXX where XX = district number.
 */
export function postalCodeToDistrictNo(postalCode: string): number | null {
  const match = postalCode.match(/^1(\d{2})0$/);
  if (!match) return null;
  const district = Number(match[1]);
  return district >= 1 && district <= 23 ? district : null;
}
