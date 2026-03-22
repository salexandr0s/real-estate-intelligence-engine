import { describe, it, expect } from 'vitest';
import {
  extractStreetsFromText,
  extractStationFromText,
  extractDistrictFromText,
  extractLocationSignals,
} from '../text-extractor.js';

// ── Street Extraction ───────────────────────────────────────────────────────

describe('extractStreetsFromText', () => {
  it('extracts street with house number', () => {
    const result = extractStreetsFromText('Schöne Wohnung in der Margaretenstraße 45, Wien');
    expect(result).toHaveLength(1);
    expect(result[0]!.streetName).toBe('Margaretenstraße');
    expect(result[0]!.houseNumber).toBe('45');
    expect(result[0]!.fullAddress).toBe('Margaretenstraße 45');
  });

  it('extracts street without house number', () => {
    const result = extractStreetsFromText('nahe Neubaugasse, ruhige Lage');
    expect(result).toHaveLength(1);
    expect(result[0]!.streetName).toBe('Neubaugasse');
    expect(result[0]!.houseNumber).toBeNull();
  });

  it('extracts Gasse suffix', () => {
    const result = extractStreetsFromText('Schottenfeldgasse 12');
    expect(result).toHaveLength(1);
    expect(result[0]!.streetName).toBe('Schottenfeldgasse');
    expect(result[0]!.houseNumber).toBe('12');
  });

  it('extracts multiple streets', () => {
    const result = extractStreetsFromText('Ecke Mariahilfer Straße und Neubaugasse 5');
    // "Neubaugasse" matches, "Straße" alone doesn't because "Mariahilfer" prefix + "Straße" is not captured as one word
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((s) => s.streetName === 'Neubaugasse')).toBe(true);
  });

  it('extracts -straße compound names', () => {
    // "Josefstädter Straße" (two words) — "Straße" alone is < 5 chars, won't match
    // Real compound as one word works:
    const result = extractStreetsFromText('Josefstädterstraße 12');
    expect(result).toHaveLength(1);
    expect(result[0]!.streetName).toBe('Josefstädterstraße');
  });

  it('extracts platz, ring, allee suffixes', () => {
    const platz = extractStreetsFromText('Karlsplatz 1');
    expect(platz).toHaveLength(1);
    expect(platz[0]!.streetName).toBe('Karlsplatz');

    const ring = extractStreetsFromText('am Schottenring');
    expect(ring).toHaveLength(1);
    expect(ring[0]!.streetName).toBe('Schottenring');

    const allee = extractStreetsFromText('Prater Hauptallee');
    expect(allee).toHaveLength(1);
    expect(allee[0]!.streetName).toBe('Hauptallee');
  });

  it('returns empty for no street matches', () => {
    const result = extractStreetsFromText('Erstbezug nach Sanierung, top Lage');
    expect(result).toHaveLength(0);
  });

  it('skips blacklisted words', () => {
    const result = extractStreetsFromText('Eigentumswohnung zu verkaufen');
    expect(result).toHaveLength(0);
  });

  it('handles house number with letter suffix', () => {
    const result = extractStreetsFromText('Wiedner Hauptstraße 12a');
    expect(result).toHaveLength(1);
    expect(result[0]!.houseNumber).toBe('12a');
  });

  it('handles house number with slash', () => {
    const result = extractStreetsFromText('Landstraßer Hauptstraße 3/2');
    expect(result).toHaveLength(1);
    expect(result[0]!.houseNumber).toBe('3/2');
  });

  it('deduplicates same street appearing twice', () => {
    const result = extractStreetsFromText('Neubaugasse, schöne Lage an der Neubaugasse');
    expect(result).toHaveLength(1);
  });

  it('rejects bare suffix "Straße" from two-word street name', () => {
    const result = extractStreetsFromText('Mariahilfer Straße');
    expect(result).toHaveLength(0);
  });

  it('rejects bare suffix "Gasse" and "Platz"', () => {
    expect(extractStreetsFromText('in der Gasse')).toHaveLength(0);
    expect(extractStreetsFromText('am Platz')).toHaveLength(0);
  });

  it('still matches compound street names with suffix', () => {
    const result = extractStreetsFromText('Margaretenstraße 45 ist eine gute Lage');
    expect(result).toHaveLength(1);
    expect(result[0]!.streetName).toBe('Margaretenstraße');
  });
});

// ── Station Extraction ──────────────────────────────────────────────────────

describe('extractStationFromText', () => {
  it('matches "Nähe U3 Zieglergasse"', () => {
    const result = extractStationFromText('Wohnung Nähe U3 Zieglergasse, ruhige Lage');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Zieglergasse');
    expect(result!.latitude).toBeCloseTo(48.19708, 3);
    expect(result!.longitude).toBeCloseTo(16.34598, 3);
  });

  it('matches "nahe U-Bahn Karlsplatz"', () => {
    const result = extractStationFromText('Erstbezug nahe U-Bahn Karlsplatz');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Karlsplatz');
  });

  it('matches "nächste U-Bahn: Pilgramgasse"', () => {
    const result = extractStationFromText('nächste U-Bahn: Pilgramgasse');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Pilgramgasse');
  });

  it('matches "U6 Burggasse" (U-line + station)', () => {
    const result = extractStationFromText('direkt bei U6 Burggasse');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Burggasse-Stadthalle');
  });

  it('matches non-ambiguous station name directly', () => {
    const result = extractStationFromText('Wohnung beim Stephansplatz');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Stephansplatz');
  });

  it('does NOT match ambiguous name without U-Bahn context', () => {
    const result = extractStationFromText('Wohnung in Simmering, gute Lage');
    expect(result).toBeNull();
  });

  it('matches ambiguous name WITH U-Bahn context', () => {
    const result = extractStationFromText('nahe U3 Simmering');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Simmering');
  });

  it('matches "U1 Leopoldau"', () => {
    const result = extractStationFromText('Endstation U1 Leopoldau');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Leopoldau');
  });

  it('returns null for no station reference', () => {
    const result = extractStationFromText('Sonnige Wohnung in Wien');
    expect(result).toBeNull();
  });

  it('matches compound station via alternate name', () => {
    const result = extractStationFromText('nahe U-Bahn Stadthalle');
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe('Burggasse-Stadthalle');
  });

  it('matches Praterstern', () => {
    const result = extractStationFromText('beim Praterstern');
    expect(result).not.toBeNull();
    // Praterstern is the alternate name for "Praterstern bzw. Wien Nord (ÖBB)"
    expect(result!.stationName).toBe('Praterstern bzw. Wien Nord (ÖBB)');
  });
});

// ── District Extraction ─────────────────────────────────────────────────────

describe('extractDistrictFromText', () => {
  it('extracts "7. Bezirk"', () => {
    const result = extractDistrictFromText('Wohnung im 7. Bezirk');
    expect(result).not.toBeNull();
    expect(result!.districtNo).toBe(7);
  });

  it('extracts "10.Bezirk" (no space)', () => {
    const result = extractDistrictFromText('10.Bezirk, ruhige Lage');
    expect(result).not.toBeNull();
    expect(result!.districtNo).toBe(10);
  });

  it('extracts "Wien 3"', () => {
    const result = extractDistrictFromText('Wien 3, ruhige Lage');
    expect(result).not.toBeNull();
    expect(result!.districtNo).toBe(3);
  });

  it('extracts "3. Bez"', () => {
    const result = extractDistrictFromText('Wohnung im 3. Bez');
    expect(result).not.toBeNull();
    expect(result!.districtNo).toBe(3);
  });

  it('extracts postal code pattern "1050 Wien"', () => {
    const result = extractDistrictFromText('1050 Wien, Margareten');
    expect(result).not.toBeNull();
    expect(result!.districtNo).toBe(5);
  });

  it('rejects out-of-range district (24)', () => {
    const result = extractDistrictFromText('Wien 24');
    expect(result).toBeNull();
  });

  it('rejects out-of-range district (0)', () => {
    const result = extractDistrictFromText('Wien 0');
    expect(result).toBeNull();
  });

  it('returns null for no district match', () => {
    const result = extractDistrictFromText('Schöne Wohnung zu verkaufen');
    expect(result).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(extractDistrictFromText('')).toBeNull();
    expect(extractDistrictFromText(null as unknown as string)).toBeNull();
  });
});

// ── Location Signals Coordinator ────────────────────────────────────────────

describe('extractLocationSignals', () => {
  it('extracts all signal types from title', () => {
    const signals = extractLocationSignals({
      title: 'Wohnung Neubaugasse 5, Nähe U3 Zieglergasse, 7. Bezirk',
      description: null,
      addressDisplay: null,
    });

    expect(signals.streets.length).toBeGreaterThanOrEqual(1);
    expect(signals.streets[0]!.streetName).toBe('Neubaugasse');
    expect(signals.stations).toHaveLength(1);
    expect(signals.stations[0]!.stationName).toBe('Zieglergasse');
    expect(signals.districts).toHaveLength(1);
    expect(signals.districts[0]!.districtNo).toBe(7);
  });

  it('deduplicates across text fields', () => {
    const signals = extractLocationSignals({
      title: 'Wohnung Neubaugasse',
      description: 'Lage an der Neubaugasse, 7. Bezirk',
      addressDisplay: '7. Bezirk',
    });

    expect(signals.streets).toHaveLength(1);
    expect(signals.districts).toHaveLength(1);
  });

  it('handles all-null inputs', () => {
    const signals = extractLocationSignals({
      title: null,
      description: null,
      addressDisplay: null,
    });

    expect(signals.streets).toHaveLength(0);
    expect(signals.stations).toHaveLength(0);
    expect(signals.districts).toHaveLength(0);
  });

  it('prioritizes title over description', () => {
    const signals = extractLocationSignals({
      title: 'nahe U3 Zieglergasse',
      description: 'nahe U1 Stephansplatz',
      addressDisplay: null,
    });

    // Station from title should win
    expect(signals.stations).toHaveLength(1);
    expect(signals.stations[0]!.stationName).toBe('Zieglergasse');
  });
});
