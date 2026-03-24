#!/usr/bin/env npx tsx
/**
 * Fetches Vienna POI data from three sources:
 *   1. Overpass API (transit, fire stations, supermarkets, hospitals, parks, schools, police)
 *   2. Wien OGD WFS (doctors)
 *   3. Wien.gv.at taxi stands (scraped + geocoded via Nominatim)
 *
 * Outputs:
 *   - scripts/data/vienna-pois.json          (flat JSON array)
 *   - apps/macos/ImmoRadar/Resources/vienna-pois.geojson  (GeoJSON FeatureCollection)
 *
 * Usage:
 *   npx tsx scripts/fetch-vienna-pois.ts
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geocodeAddress } from '@rei/geocoding';

// ── Types ────────────────────────────────────────────────────────────────────

interface POI {
  id: string;
  externalKey: string;
  name: string;
  category: string;
  subcategory: string | null;
  lat: number;
  lon: number;
  properties?: Record<string, string | number | null>;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface OGDDoctorProperties {
  OBJECTID: number;
  NAME: string;
  ADRESSE: string;
  FACH: string;
  TELEFON: string;
  INTERNET: string;
}

interface OGDDoctorFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: OGDDoctorProperties;
}

interface OGDDoctorResponse {
  type: 'FeatureCollection';
  features: OGDDoctorFeature[];
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    name: string;
    category: string;
    subcategory: string | null;
  };
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const JSON_OUTPUT = join(process.cwd(), 'scripts', 'data', 'vienna-pois.json');
const GEOJSON_OUTPUT = join(
  process.cwd(),
  'apps',
  'macos',
  'ImmoRadar',
  'Resources',
  'vienna-pois.geojson',
);

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const WIEN_OGD_WFS =
  'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&typeName=ogdwien:ARZTOGD&outputFormat=json&srsName=EPSG:4326';
const TAXI_PAGE_URL = 'https://www.wien.gv.at/en/transportation/taxistands';

const USER_AGENT = 'ImmoRadar/0.1 (poi-fetch)';

const OVERPASS_DELAY_MS = 12_000;
const OVERPASS_MAX_RETRIES = 4;
const NOMINATIM_DELAY_MS = 1_100;

// ── Overpass category definitions ────────────────────────────────────────────

interface OverpassCategory {
  category: string;
  query: string;
}

const OVERPASS_CATEGORIES: OverpassCategory[] = [
  {
    category: 'ubahn',
    query: 'node["railway"="station"]["station"="subway"](area.vienna);',
  },
  {
    category: 'tram',
    query: 'node["railway"="tram_stop"](area.vienna);',
  },
  {
    category: 'bus',
    query: 'node["highway"="bus_stop"](area.vienna);',
  },
  {
    category: 'fire_station',
    query: [
      'node["amenity"="fire_station"](area.vienna);',
      'way["amenity"="fire_station"](area.vienna);',
    ].join('\n  '),
  },
  {
    category: 'supermarket',
    query: [
      'node["shop"="supermarket"](area.vienna);',
      'way["shop"="supermarket"](area.vienna);',
    ].join('\n  '),
  },
  {
    category: 'hospital',
    query: [
      'node["amenity"="hospital"](area.vienna);',
      'way["amenity"="hospital"](area.vienna);',
      'relation["amenity"="hospital"](area.vienna);',
    ].join('\n  '),
  },
  {
    category: 'park',
    query: ['node["leisure"="park"](area.vienna);', 'way["leisure"="park"](area.vienna);'].join(
      '\n  ',
    ),
  },
  {
    category: 'school',
    query: [
      'node["amenity"="school"](area.vienna);',
      'way["amenity"="school"](area.vienna);',
      'node["amenity"="kindergarten"](area.vienna);',
      'way["amenity"="kindergarten"](area.vienna);',
    ].join('\n  '),
  },
  {
    category: 'police',
    query: ['node["amenity"="police"](area.vienna);', 'way["amenity"="police"](area.vienna);'].join(
      '\n  ',
    ),
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ── Source 1: Overpass API ────────────────────────────────────────────────────

function buildOverpassQuery(categoryQuery: string): string {
  return [
    '[out:json][timeout:60];',
    'area["name"="Wien"]["admin_level"="4"]->.vienna;',
    '(',
    `  ${categoryQuery}`,
    ');',
    'out center body;',
  ].join('\n');
}

function extractCoords(el: OverpassElement): { lat: number; lon: number } | null {
  if (el.type === 'node' && el.lat != null && el.lon != null) {
    return { lat: el.lat, lon: el.lon };
  }
  if ((el.type === 'way' || el.type === 'relation') && el.center) {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

function elementToPOI(el: OverpassElement, category: string): POI | null {
  const coords = extractCoords(el);
  if (!coords) return null;

  const name = el.tags?.name ?? `${category}_${el.id}`;

  let subcategory: string | null = null;
  if (category === 'school' && el.tags?.amenity) {
    subcategory = el.tags.amenity === 'kindergarten' ? 'kindergarten' : 'school';
  }

  return {
    id: `${category}_overpass_${el.id}`,
    externalKey: `overpass_${el.id}`,
    name,
    category,
    subcategory,
    lat: coords.lat,
    lon: coords.lon,
  };
}

async function fetchOverpassCategory(cat: OverpassCategory): Promise<POI[]> {
  const query = buildOverpassQuery(cat.query);

  console.log(`  Fetching ${cat.category} from Overpass...`);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= OVERPASS_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = OVERPASS_DELAY_MS * (attempt + 1);
      console.log(`    Retry ${attempt}/${OVERPASS_MAX_RETRIES} after ${backoff / 1000}s...`);
      await sleep(backoff);
    }

    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(90_000),
    });

    if (response.ok) {
      const data = (await response.json()) as OverpassResponse;
      const pois: POI[] = [];
      for (const el of data.elements) {
        const poi = elementToPOI(el, cat.category);
        if (poi) pois.push(poi);
      }
      console.log(`    -> ${formatCount(pois.length)} ${cat.category} POIs`);
      return pois;
    }

    const text = await response.text().catch(() => 'unknown');
    lastError = new Error(`Overpass returned ${response.status}: ${text.slice(0, 200)}`);

    if (response.status !== 429 && response.status !== 504) {
      throw lastError; // Non-retryable error
    }
  }

  throw lastError ?? new Error('Overpass fetch failed');
}

async function fetchAllOverpass(): Promise<POI[]> {
  console.log('\n=== Source 1: Overpass API ===');
  const allPOIs: POI[] = [];

  for (let i = 0; i < OVERPASS_CATEGORIES.length; i++) {
    const cat = OVERPASS_CATEGORIES[i]!;
    try {
      const pois = await fetchOverpassCategory(cat);
      allPOIs.push(...pois);
    } catch (err) {
      console.error(
        `  ERROR fetching ${cat.category}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Rate limit between requests (skip delay after last request)
    if (i < OVERPASS_CATEGORIES.length - 1) {
      await sleep(OVERPASS_DELAY_MS);
    }
  }

  return allPOIs;
}

// ── Source 2: Wien OGD WFS (doctors) ─────────────────────────────────────────

async function fetchDoctorsOGD(): Promise<POI[]> {
  console.log('\n=== Source 2: Wien OGD WFS (doctors) ===');
  console.log('  Fetching doctors from Wien OGD...');

  const response = await fetch(WIEN_OGD_WFS, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Wien OGD returned ${response.status}`);
  }

  const data = (await response.json()) as OGDDoctorResponse;
  const pois: POI[] = [];

  for (const feature of data.features) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;

    if (!coords || coords.length < 2) continue;

    const lon = coords[0];
    const lat = coords[1];

    if (lon == null || lat == null || isNaN(lon) || isNaN(lat)) continue;

    pois.push({
      id: `doctor_ogd_${props.OBJECTID}`,
      externalKey: `ogd_${props.OBJECTID}`,
      name: props.NAME ?? `Doctor ${props.OBJECTID}`,
      category: 'doctor',
      subcategory: props.FACH ?? null,
      lat,
      lon,
      properties: {
        specialty: props.FACH ?? null,
        address: props.ADRESSE ?? null,
        phone: props.TELEFON ?? null,
      },
    });
  }

  console.log(`    -> ${formatCount(pois.length)} doctor POIs`);
  return pois;
}

// ── Source 3: Wien.gv.at Taxi Stands ─────────────────────────────────────────

interface TaxiStandEntry {
  address: string;
  district: number;
  standCount: number | null;
}

function parseTaxiStandsHtml(html: string): TaxiStandEntry[] {
  const entries: TaxiStandEntry[] = [];
  let currentDistrict = 0;

  // Split into lines for simpler processing
  const lines = html.split('\n');

  for (const line of lines) {
    // Look for district headers like "1st district" or "10th district"
    const districtMatch = /(\d+)(?:st|nd|rd|th)\s+district/i.exec(line);
    if (districtMatch?.[1]) {
      currentDistrict = parseInt(districtMatch[1], 10);
      continue;
    }

    // Look for addresses in list items or table cells
    // Typical patterns: street names ending with common suffixes
    const addressPatterns = [
      // Match content inside <li> or <td> tags that looks like a street address
      /<(?:li|td)[^>]*>([^<]*(?:straße|gasse|weg|platz|ring|gürtel|allee|promenade|zeile|kai|damm|markt)[^<]*)<\/(?:li|td)>/gi,
      // Also match plain text lines with address-like content
      />\s*([^<]*(?:straße|gasse|weg|platz|ring|gürtel|allee|promenade|zeile|kai|damm|markt)[^<]*)\s*</gi,
    ];

    for (const pattern of addressPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const address = match[1]?.trim();
        if (!address || address.length < 3 || address.length > 200) continue;

        // Skip if it looks like navigation or footer text
        if (/copyright|privacy|cookie|footer|menu|nav/i.test(address)) continue;

        // Try to extract stand count from nearby text
        const countMatch = /(\d+)\s*(?:stand|taxi)/i.exec(line);
        const standCount = countMatch?.[1] ? parseInt(countMatch[1], 10) : null;

        // Avoid duplicates
        if (!entries.some((e) => e.address === address && e.district === currentDistrict)) {
          entries.push({
            address,
            district: currentDistrict || 1,
            standCount,
          });
        }
      }
    }
  }

  return entries;
}

async function geocodeTaxiStand(entry: TaxiStandEntry): Promise<POI | null> {
  // Clean address: strip district prefix "N., " and simplify for Nominatim
  let street = entry.address.replace(/^\d+\.,\s*/, '');
  // Remove "ggü." (gegenüber/opposite) markers
  street = street.replace(/\s*ggü\.?\s*/g, ' ').trim();
  // Remove parenthetical notes like "(Bereich Walcherstraße)"
  street = street.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
  // Collapse multiple spaces
  street = street.replace(/\s+/g, ' ');

  const result = await geocodeAddress({
    street,
    city: 'Wien',
    country: 'at',
  });

  if (!result) {
    console.log(`    SKIP (geocoding failed): ${street}`);
    return null;
  }

  const slug = slugify(entry.address);

  return {
    id: `taxi_wien_${entry.district}_${slug}`,
    externalKey: `wien_taxi_${entry.district}_${slug}`,
    name: entry.address,
    category: 'taxi',
    subcategory: null,
    lat: result.lat,
    lon: result.lon,
    properties: {
      standCount: entry.standCount,
    },
  };
}

async function fetchTaxiOverpassFallback(): Promise<POI[]> {
  console.log('  Falling back to Overpass for taxi stands...');

  const query = buildOverpassQuery(
    'node["amenity"="taxi"](area.vienna);\n  way["amenity"="taxi"](area.vienna);',
  );

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    throw new Error(`Overpass taxi fallback returned ${response.status}`);
  }

  const data = (await response.json()) as OverpassResponse;
  const pois: POI[] = [];

  for (const el of data.elements) {
    const coords = extractCoords(el);
    if (!coords) continue;

    const name = el.tags?.name ?? `taxi_${el.id}`;
    pois.push({
      id: `taxi_overpass_${el.id}`,
      externalKey: `overpass_taxi_${el.id}`,
      name,
      category: 'taxi',
      subcategory: null,
      lat: coords.lat,
      lon: coords.lon,
    });
  }

  console.log(`    -> ${formatCount(pois.length)} taxi POIs (Overpass fallback)`);
  return pois;
}

async function fetchTaxiStands(): Promise<POI[]> {
  console.log('\n=== Source 3: Wien.gv.at Taxi Stands ===');
  console.log(`  Fetching taxi page: ${TAXI_PAGE_URL}`);

  let html: string;
  try {
    const response = await fetch(TAXI_PAGE_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Taxi page returned ${response.status}`);
    }

    html = await response.text();
  } catch (err) {
    console.error(
      `  ERROR fetching taxi page: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fetchTaxiOverpassFallback();
  }

  const entries = parseTaxiStandsHtml(html);
  console.log(`  Parsed ${entries.length} taxi stand entries from HTML`);

  if (entries.length === 0) {
    console.warn('  WARNING: No taxi stands parsed from HTML, using Overpass fallback');
    return fetchTaxiOverpassFallback();
  }

  const pois: POI[] = [];
  let geocoded = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const poi = await geocodeTaxiStand(entry);
      if (poi) {
        pois.push(poi);
        geocoded++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(
        `    ERROR geocoding "${entry.address}": ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }

    // Rate limit: 1 request per second for Nominatim
    await sleep(NOMINATIM_DELAY_MS);
  }

  console.log(`    -> ${formatCount(geocoded)} geocoded, ${failed} failed`);

  // If very few results geocoded, supplement with Overpass fallback
  if (geocoded < 5) {
    console.warn('  WARNING: Very few taxi stands geocoded, supplementing with Overpass fallback');
    const fallback = await fetchTaxiOverpassFallback();
    pois.push(...fallback);
  }

  return pois;
}

// ── Output ───────────────────────────────────────────────────────────────────

function buildJsonOutput(pois: POI[]): string {
  // Sort by category, then by name
  const sorted = [...pois].sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name);
  });

  // Strip internal-only properties for the JSON output
  const output = sorted.map((poi) => ({
    id: poi.id,
    externalKey: poi.externalKey,
    name: poi.name,
    category: poi.category,
    subcategory: poi.subcategory,
    lat: poi.lat,
    lon: poi.lon,
  }));

  return JSON.stringify(output, null, 2);
}

function buildGeoJsonOutput(pois: POI[]): string {
  // Sort by category, then by name (same as JSON output)
  const sorted = [...pois].sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name);
  });

  const features: GeoJSONFeature[] = sorted.map((poi) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [poi.lon, poi.lat] as [number, number],
    },
    properties: {
      id: poi.id,
      name: poi.name,
      category: poi.category,
      subcategory: poi.subcategory,
    },
  }));

  const collection: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  return JSON.stringify(collection);
}

function printSummary(pois: POI[]): void {
  const counts = new Map<string, number>();
  for (const poi of pois) {
    counts.set(poi.category, (counts.get(poi.category) ?? 0) + 1);
  }

  // Sort categories alphabetically
  const sortedCategories = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));

  const maxLabelLen = Math.max(...sortedCategories.map(([cat]) => cat.length));

  console.log('\nPOI Fetch Complete:');
  for (const [category, count] of sortedCategories) {
    const label = `${category}:`.padEnd(maxLabelLen + 2);
    console.log(`  ${label}${formatCount(count).padStart(8)}`);
  }
  console.log(`  ${'Total:'.padEnd(maxLabelLen + 2)}${formatCount(pois.length).padStart(8)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Vienna POI Fetch');
  console.log('='.repeat(50));

  const allPOIs: POI[] = [];

  // Source 1: Overpass API
  try {
    const overpassPOIs = await fetchAllOverpass();
    allPOIs.push(...overpassPOIs);
  } catch (err) {
    console.error(`Overpass source failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Source 2: Wien OGD WFS (doctors)
  try {
    const doctorPOIs = await fetchDoctorsOGD();
    allPOIs.push(...doctorPOIs);
  } catch (err) {
    console.error(`Wien OGD source failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Source 3: Taxi stands
  try {
    const taxiPOIs = await fetchTaxiStands();
    allPOIs.push(...taxiPOIs);
  } catch (err) {
    console.error(`Taxi source failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (allPOIs.length === 0) {
    console.error('\nERROR: No POIs fetched from any source. Aborting write.');
    process.exitCode = 1;
    return;
  }

  // Write JSON output
  const jsonContent = buildJsonOutput(allPOIs);
  writeFileSync(JSON_OUTPUT, jsonContent, 'utf-8');
  console.log(`\nWrote ${JSON_OUTPUT}`);

  // Write GeoJSON output
  const geoJsonContent = buildGeoJsonOutput(allPOIs);
  writeFileSync(GEOJSON_OUTPUT, geoJsonContent, 'utf-8');
  console.log(`Wrote ${GEOJSON_OUTPUT}`);

  printSummary(allPOIs);
}

main().catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
