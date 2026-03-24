/**
 * Import POIs from the fetched JSON file into the database pois table.
 * Run after fetch-vienna-pois.ts to populate the DB.
 *
 * Usage: npx tsx scripts/import-pois-to-db.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pois } from '@immoradar/db';

interface PoiJson {
  id: string;
  externalKey: string;
  name: string;
  category: string;
  subcategory: string | null;
  lat: number;
  lon: number;
  districtNo?: number | null;
  properties?: Record<string, unknown>;
}

const JSON_PATH = join(process.cwd(), 'scripts', 'data', 'vienna-pois.json');

async function main() {
  const raw = readFileSync(JSON_PATH, 'utf-8');
  const items: PoiJson[] = JSON.parse(raw);
  console.log(`Loaded ${items.length} POIs from ${JSON_PATH}`);

  let imported = 0;
  let errors = 0;

  for (const item of items) {
    try {
      await pois.upsertPoi({
        sourceId: item.id,
        externalKey: item.externalKey,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        latitude: item.lat,
        longitude: item.lon,
        districtNo: item.districtNo ?? null,
        properties: item.properties,
      });
      imported++;
      if (imported % 1000 === 0) {
        console.log(`  ${imported}/${items.length} imported...`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  Error importing ${item.id}:`, (err as Error).message);
      }
    }
  }

  console.log(`\nDone: ${imported} imported, ${errors} errors`);
  process.exit(0);
}

main();
