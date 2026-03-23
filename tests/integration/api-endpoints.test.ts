import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetConfig } from '@rei/config';
import { buildApp } from '../../apps/api/src/app.js';

const AUTH_HEADER = { authorization: 'Bearer dev-token' };
const hasDb = !!process.env.DATABASE_URL;

describe('API endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetConfig();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health & Metrics ───────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string }>();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /metrics', () => {
    it('returns prometheus text format without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/');
    });
  });

  describe('GET /metrics (token-protected)', () => {
    let protectedApp: FastifyInstance;
    const metricsToken = 'test-metrics-secret';

    beforeAll(async () => {
      process.env.METRICS_TOKEN = metricsToken;
      resetConfig();
      protectedApp = await buildApp();
      await protectedApp.ready();
    });

    afterAll(async () => {
      await protectedApp.close();
      delete process.env.METRICS_TOKEN;
      resetConfig();
    });

    it('rejects query-param token (removed)', async () => {
      const res = await protectedApp.inject({
        method: 'GET',
        url: `/metrics?token=${metricsToken}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 200 with correct Bearer token', async () => {
      const res = await protectedApp.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${metricsToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 403 with wrong Bearer token', async () => {
      const res = await protectedApp.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 without any auth', async () => {
      const res = await protectedApp.inject({
        method: 'GET',
        url: '/metrics',
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/listings' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/listings',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── OpenAPI / Swagger ──────────────────────────────────────────────────────

  describe('GET /docs/json', () => {
    it('returns OpenAPI spec without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/docs/json' });
      expect(res.statusCode).toBe(200);
      const spec = res.json<{ openapi: string; info: { title: string } }>();
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.info.title).toBe('Real Estate Intelligence Engine API');
    });
  });

  describe('GET /docs/json (protected)', () => {
    let protectedApp: FastifyInstance;

    beforeAll(async () => {
      process.env.API_DOCS_PUBLIC = 'false';
      resetConfig();
      protectedApp = await buildApp();
      await protectedApp.ready();
    });

    afterAll(async () => {
      await protectedApp.close();
      delete process.env.API_DOCS_PUBLIC;
      resetConfig();
    });

    it('returns 401 without auth when docs are private', async () => {
      const res = await protectedApp.inject({ method: 'GET', url: '/docs/json' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with auth when docs are private', async () => {
      const res = await protectedApp.inject({
        method: 'GET',
        url: '/docs/json',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Listings ───────────────────────────────────────────────────────────────

  describe('GET /v1/listings', () => {
    it.skipIf(!hasDb)('returns 200 with listings array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/listings',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; meta: Record<string, unknown> }>();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta).toBeDefined();
    });

    it.skipIf(!hasDb)('supports cursor pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/listings?limit=2',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; meta: { nextCursor: string | null } }>();
      expect(body.data.length).toBeLessThanOrEqual(2);
    });

    it.skipIf(!hasDb)('filters by operationType', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/listings?operationType=sale',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Sources ────────────────────────────────────────────────────────────────

  describe('GET /v1/sources', () => {
    it.skipIf(!hasDb)('returns 200 with sources array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sources',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[] }>();
      expect(body.data).toBeInstanceOf(Array);
    });
  });

  // ── Filters ────────────────────────────────────────────────────────────────

  describe('POST /v1/filters', () => {
    it('returns 400 for invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/filters',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: '' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it.skipIf(!hasDb)('returns 201 for valid filter', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/filters',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Test Filter',
          filterKind: 'listing_search',
          operationType: 'sale',
          districts: [1, 2, 3],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ data: { id: number; name: string } }>();
      expect(body.data.name).toBe('Test Filter');
    });
  });

  // ── Alerts ─────────────────────────────────────────────────────────────────

  describe('GET /v1/alerts', () => {
    it.skipIf(!hasDb)('returns 200 with alerts array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/alerts',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; meta: Record<string, unknown> }>();
      expect(body.data).toBeInstanceOf(Array);
    });
  });

  // ── 404 ────────────────────────────────────────────────────────────────────

  describe('Unknown routes', () => {
    it('returns 404 for unregistered paths', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/nonexistent',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
