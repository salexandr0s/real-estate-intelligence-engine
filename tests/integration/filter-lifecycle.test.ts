import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { query, runMigrations, userFilters } from '@immoradar/db';
import { createPostgresTestDatabase } from './helpers/postgres-test-db.js';

const AUTH_HEADER = { authorization: 'Bearer dev-token' };

const testDb = createPostgresTestDatabase({
  namePrefix: 'immoradar_test_filter_lifecycle',
  enabled: true,
});

let app: FastifyInstance;

interface FilterDto {
  id: number;
  name: string;
  isActive: boolean;
  alertFrequency: string;
  districts: number[];
  propertyTypes: string[];
  minPriceEur: number | null;
  maxPriceEur: number | null;
  minAreaSqm: number | null;
  requiredKeywords: string[];
}

/** The body the app's filter editor sends for both create and edit. */
function editorBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Leopoldstadt Altbau',
    filterKind: 'alert',
    operationType: 'sale',
    propertyTypes: ['apartment'],
    districts: [2],
    maxPriceEur: 300000,
    minAreaSqm: 50,
    requiredKeywords: ['altbau'],
    excludedKeywords: [],
    alertFrequency: 'instant',
    ...overrides,
  };
}

async function createFilter(body: Record<string, unknown>): Promise<FilterDto> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/filters',
    headers: AUTH_HEADER,
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ data: FilterDto }>().data;
}

async function getFilter(id: number): Promise<{ statusCode: number; data: FilterDto | null }> {
  const res = await app.inject({ method: 'GET', url: `/v1/filters/${id}`, headers: AUTH_HEADER });
  return {
    statusCode: res.statusCode,
    data: res.statusCode === 200 ? res.json<{ data: FilterDto }>().data : null,
  };
}

async function patchFilter(id: number, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/filters/${id}`,
    headers: AUTH_HEADER,
    payload: body,
  });
}

async function listFilterIds(): Promise<Array<{ id: number; isActive: boolean }>> {
  const res = await app.inject({ method: 'GET', url: '/v1/filters', headers: AUTH_HEADER });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: FilterDto[] }>().data.map(({ id, isActive }) => ({ id, isActive }));
}

beforeAll(async () => {
  await testDb.setup();
  await runMigrations();
  // The dev token signs in as user 1.
  await query(`INSERT INTO app_users (id, display_name) VALUES (1, 'Owner')`);
  const { buildApp } = await import('../../apps/api/src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await testDb.teardown();
});

describe('PATCH /v1/filters/:id', () => {
  it('saves edited criteria and clears the bounds the edit leaves out', async () => {
    const created = await createFilter(editorBody());

    const edit = await patchFilter(
      created.id,
      editorBody({ districts: [3, 7], maxPriceEur: 350000, minAreaSqm: undefined }),
    );
    expect(edit.statusCode).toBe(200);

    const edited = (await getFilter(created.id)).data;
    expect(edited).toMatchObject({ districts: [3, 7], maxPriceEur: 350000, minAreaSqm: null });

    const cleared = await patchFilter(created.id, editorBody({ maxPriceEur: undefined }));
    expect(cleared.statusCode).toBe(200);
    expect((await getFilter(created.id)).data).toMatchObject({
      maxPriceEur: null,
      minAreaSqm: 50,
      districts: [2],
    });
  });

  it('leaves the criteria alone when the body has no criteria field', async () => {
    const created = await createFilter(editorBody());

    const res = await patchFilter(created.id, { isActive: false });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: FilterDto }>().data).toMatchObject({
      isActive: false,
      maxPriceEur: 300000,
      districts: [2],
      requiredKeywords: ['altbau'],
    });
  });

  it('rejects an inverted range with a 400', async () => {
    const created = await createFilter(editorBody());

    const res = await patchFilter(created.id, editorBody({ minPriceEur: 400000 }));

    expect(res.statusCode).toBe(400);
  });
});

describe('pausing and deleting a filter', () => {
  it('keeps a paused filter in the list and drops a deleted one', async () => {
    const created = await createFilter(editorBody({ name: 'Pause me' }));

    expect((await patchFilter(created.id, { isActive: false })).statusCode).toBe(200);
    expect(await listFilterIds()).toContainEqual({ id: created.id, isActive: false });

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/filters/${created.id}`,
      headers: AUTH_HEADER,
    });
    expect(del.statusCode).toBe(204);
    expect((await listFilterIds()).map((f) => f.id)).not.toContain(created.id);
    expect((await getFilter(created.id)).statusCode).toBe(404);
    expect((await patchFilter(created.id, { isActive: true })).statusCode).toBe(404);
  });
});

describe('alert matching', () => {
  it('alerts only for active, undeleted alert filters whose frequency is not manual', async () => {
    const make = async (
      name: string,
      filterKind: 'alert' | 'listing_search',
      alertFrequency: string,
    ) => (await createFilter(editorBody({ name, filterKind, alertFrequency }))).id;

    const instant = await make('instant', 'alert', 'instant');
    const digest = await make('digest', 'alert', 'hourly_digest');
    const manual = await make('manual', 'alert', 'manual');
    const savedSearch = await make('saved search', 'listing_search', 'instant');
    const paused = await make('paused', 'alert', 'instant');
    const deleted = await make('deleted', 'alert', 'instant');
    await patchFilter(paused, { isActive: false });
    await app.inject({ method: 'DELETE', url: `/v1/filters/${deleted}`, headers: AUTH_HEADER });

    const result = await userFilters.findMatchingFilters({
      operationType: 'sale',
      propertyType: 'apartment',
      districtNo: 2,
      listPriceEurCents: 250_000_00,
      livingAreaSqm: 60,
      rooms: 2,
      currentScore: 70,
      title: 'Altbau mit Balkon',
      description: null,
    });

    const matchedIds = result.matched.map((f) => f.id);
    expect(matchedIds).toEqual(expect.arrayContaining([instant, digest]));
    for (const silent of [manual, savedSearch, paused, deleted]) {
      expect(matchedIds).not.toContain(silent);
    }
  });
});
