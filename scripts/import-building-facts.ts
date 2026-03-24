#!/usr/bin/env npx tsx
/**
 * Import Vienna OGD building data from a GeoJSON file into building_facts.
 *
 * Reads a GeoJSON FeatureCollection, extracts address, coordinates, year_built,
 * and typology from each feature, and upserts into the building_facts table.
 *
 * Usage:
 *   npx tsx scripts/import-building-facts.ts <path-to-geojson>
 */

import { readFile } from 'node:fs/promises';

import { loadConfig } from '@immoradar/config';
import { createLogger } from '@immoradar/observability';
import { buildingFacts, closePool } from '@immoradar/db';

const log = createLogger('import-buildings-cli');

// ── GeoJSON types ──────────────────────────────────────────────────────────

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a [lon, lat] pair from the geometry.
 * For Point geometries, coordinates are [lon, lat].
 * For Polygon/MultiPolygon, we take the centroid of the first ring.
 */
function extractCoordinates(
  geometry: GeoJsonFeature['geometry'],
): { lat: number; lon: number } | null {
  if (geometry.type === 'Point') {
    const coords = geometry.coordinates as number[];
    if (coords.length >= 2) {
      return { lon: coords[0]!, lat: coords[1]! };
    }
    return null;
  }

  if (geometry.type === 'Polygon') {
    const ring = (geometry.coordinates as number[][][])[0];
    if (!ring || ring.length === 0) return null;
    // Compute centroid of the first ring
    let sumLon = 0;
    let sumLat = 0;
    for (const coord of ring) {
      sumLon += coord[0]!;
      sumLat += coord[1]!;
    }
    return { lon: sumLon / ring.length, lat: sumLat / ring.length };
  }

  if (geometry.type === 'MultiPolygon') {
    const firstPolygon = (geometry.coordinates as unknown as number[][][][])[0];
    const ring = firstPolygon?.[0];
    if (!ring || ring.length === 0) return null;
    let sumLon = 0;
    let sumLat = 0;
    for (const coord of ring) {
      sumLon += coord[0]!;
      sumLat += coord[1]!;
    }
    return { lon: sumLon / ring.length, lat: sumLat / ring.length };
  }

  return null;
}

/**
 * Build a normalized building key from street and house number.
 */
function normalizeBuildingKey(street: string | null, houseNumber: string | null): string | null {
  if (!street) return null;
  const parts = [street, houseNumber].filter(Boolean).join(' ');
  return parts.toLowerCase().trim() || null;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Error: file path argument is required');
    console.error('Usage: npx tsx scripts/import-building-facts.ts <path-to-geojson>');
    process.exit(1);
  }

  loadConfig();

  log.info('Reading GeoJSON file', { filePath });

  const raw = await readFile(filePath, 'utf-8');
  const geojson: GeoJsonCollection = JSON.parse(raw);

  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    log.error('Invalid GeoJSON: expected a FeatureCollection');
    process.exit(1);
  }

  log.info(`Parsed ${geojson.features.length} features`);

  let processed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const feature of geojson.features) {
    processed++;

    try {
      const props = feature.properties;
      const street = (props.STRNAML ?? props.STRASSE ?? props.strasse ?? props.street ?? null) as
        | string
        | null;
      const houseNumber = (props.VONN ??
        props.HAUSNUMMER ??
        props.hausnummer ??
        props.house_number ??
        props.ONR ??
        null) as string | number | null;
      const yearBuilt = (props.BAUJAHR ?? props.baujahr ?? props.year_built ?? null) as
        | number
        | string
        | null;
      const buildingEra = (props.L_BAUJ ?? null) as string | null;
      const typology = (props.L_BAUTYP ??
        props.BAUTYP ??
        props.bautyp ??
        props.typology ??
        props.GEBAEUDETYP ??
        null) as string | null;
      const sourceRecordId = (props.OBJECTID ?? props.objectid ?? props.id ?? null) as
        | string
        | number
        | null;
      const addressText = (props.ADRESSE ?? props.adresse ?? props.address ?? null) as
        | string
        | null;

      const buildingKey = normalizeBuildingKey(
        street,
        houseNumber != null ? String(houseNumber) : null,
      );
      if (!buildingKey) {
        skipped++;
        continue;
      }

      const coords = extractCoordinates(feature.geometry);

      const yearBuiltNum = yearBuilt != null ? Number(yearBuilt) : null;
      const validYear =
        yearBuiltNum != null && !isNaN(yearBuiltNum) && yearBuiltNum > 1000 ? yearBuiltNum : null;

      const factsJson: Record<string, unknown> = {};
      if (validYear != null) factsJson.year_built = validYear;
      if (buildingEra != null) factsJson.building_era = buildingEra;
      if (typology != null) factsJson.typology = typology;
      // Preserve other potentially useful properties
      const floors = props.GESCH_ANZ ?? props.STOCKWERKE ?? props.stockwerke;
      if (floors != null) factsJson.floors = floors;
      const usage = props.L_NUTZUNG ?? props.NUTZUNG ?? props.nutzung;
      if (usage != null) factsJson.usage = usage;

      const result = await buildingFacts.upsertBuildingFact({
        buildingKey,
        sourceName: 'vienna_ogd',
        sourceRecordId: sourceRecordId != null ? String(sourceRecordId) : null,
        addressText:
          addressText ?? (`${street ?? ''}${houseNumber ? ' ' + houseNumber : ''}`.trim() || null),
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        factsJson,
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

      if (processed % 500 === 0) {
        log.info(`Progress: ${processed}/${geojson.features.length}`, {
          created,
          updated,
          skipped,
          errors,
        });
      }
    } catch (err) {
      errors++;
      if (errors <= 10) {
        log.error(`Error processing feature #${processed}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Summary
  console.log('\n=== Building Facts Import Summary ===');
  console.log(`Total features: ${geojson.features.length}`);
  console.log(`Processed:      ${processed}`);
  console.log(`Created:        ${created}`);
  console.log(`Updated:        ${updated}`);
  console.log(`Skipped:        ${skipped}`);
  console.log(`Errors:         ${errors}`);
  console.log('=====================================\n');

  await closePool();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
