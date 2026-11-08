import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapDefaults, DEFAULT_SOURCE_SEEDS, query, runMigrations } from '@immoradar/db';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const POI_FILE = path.resolve(__dirname, '../../packages/db/data/vienna-pois.json');

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_bootstrap',
  enabled: true,
});

// The file repeats some keys, and the table keeps one row per (source_id, external_key).
function distinctPoiKeys(): number {
  const pois = JSON.parse(fs.readFileSync(POI_FILE, 'utf8')) as Array<{
    id: string;
    externalKey: string;
  }>;
  return new Set(pois.map((poi) => `${poi.id}\n${poi.externalKey}`)).size;
}

async function countRows(table: 'app_users' | 'sources' | 'pois'): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(rows[0]?.count);
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
});

afterAll(async () => {
  await testDb.teardown();
});

describe('bootstrapDefaults', () => {
  it('fills a freshly migrated database with the owner, the sources and the POIs', async () => {
    const poiCount = distinctPoiKeys();

    await expect(bootstrapDefaults()).resolves.toEqual({
      ownerInserted: true,
      sourcesInserted: DEFAULT_SOURCE_SEEDS.length,
      poisInserted: poiCount,
    });

    expect(await query('SELECT id, email FROM app_users')).toEqual([{ id: '1', email: null }]);
    expect(await countRows('sources')).toBe(DEFAULT_SOURCE_SEEDS.length);
    expect(await countRows('pois')).toBe(poiCount);
  });

  it('inserts nothing on the next start', async () => {
    await expect(bootstrapDefaults()).resolves.toEqual({
      ownerInserted: false,
      sourcesInserted: 0,
      poisInserted: 0,
    });

    expect(await countRows('app_users')).toBe(1);
    expect(await countRows('sources')).toBe(DEFAULT_SOURCE_SEEDS.length);
    expect(await countRows('pois')).toBe(distinctPoiKeys());
  });

  it('adds no sources once any source exists, and keeps its settings', async () => {
    await query(`UPDATE sources SET is_active = FALSE WHERE code = 'willhaben'`);
    await query(`DELETE FROM sources WHERE code <> 'willhaben'`);

    const result = await bootstrapDefaults();

    expect(result.sourcesInserted).toBe(0);
    expect(await query('SELECT code, is_active FROM sources')).toEqual([
      { code: 'willhaben', is_active: false },
    ]);
  });
});
