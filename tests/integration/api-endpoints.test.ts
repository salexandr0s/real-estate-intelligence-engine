import { createServer } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetConfig } from '@immoradar/config';
import { query } from '@immoradar/db';
import { buildApp } from '../../apps/api/src/app.js';
import { seed } from '../../packages/db/seeds/seed.js';

const AUTH_HEADER = { authorization: 'Bearer dev-token' };
const hasDb = !!process.env.DATABASE_URL;

interface HealthBody {
  status: string;
  checks: { postgres: string; redis: string };
}

/** A local port nothing listens on: the OS hands it out, and it is released again. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('API endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.METRICS_TOKEN;
    delete process.env.API_DOCS_PUBLIC;
    process.env.PROMETHEUS_ENABLED = 'true';
    resetConfig();
    // Filter writes reference the owner row, which migrations alone do not create.
    if (hasDb) await seed();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.METRICS_TOKEN;
    delete process.env.API_DOCS_PUBLIC;
    delete process.env.PROMETHEUS_ENABLED;
    resetConfig();
  });

  // ── Health & Metrics ───────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it.skipIf(!hasDb)('reports ok when Postgres and Redis both answer', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.json<HealthBody>()).toMatchObject({
        status: 'ok',
        checks: { postgres: 'ok', redis: 'ok' },
      });
    });
  });

  // The app restarts the API when /health fails, and a restart can't bring Redis back, so the API
  // keeps answering 200 within the app's 2 s probe and names what is down.
  describe('GET /health (Redis unreachable)', () => {
    let downApp: FastifyInstance;
    const originalRedisUrl = process.env.REDIS_URL;

    beforeAll(async () => {
      process.env.REDIS_URL = `redis://127.0.0.1:${await closedPort()}`;
      resetConfig();
      downApp = await buildApp();
      await downApp.ready();
    });

    afterAll(async () => {
      await downApp.close();
      if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = originalRedisUrl;
      resetConfig();
    });

    it('answers 200 quickly, degraded, with redis marked as the failed check', async () => {
      const startedAt = Date.now();
      const res = await downApp.inject({ method: 'GET', url: '/health' });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(res.statusCode).toBe(200);
      expect(res.json<HealthBody>()).toMatchObject({
        status: 'degraded',
        checks: { redis: 'error' },
      });
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  describe('Rate limiting', () => {
    let limitedApp: FastifyInstance;
    const remote = { remoteAddress: '203.0.113.10' };

    beforeAll(async () => {
      process.env.API_RATE_LIMIT_MAX = '2';
      resetConfig();
      limitedApp = await buildApp();
      await limitedApp.ready();
    });

    afterAll(async () => {
      await limitedApp.close();
      delete process.env.API_RATE_LIMIT_MAX;
      resetConfig();
    });

    it('answers a remote client over the limit with 429, never loopback clients or /health', async () => {
      const remoteStatuses: number[] = [];
      let lastRemote = await limitedApp.inject({ method: 'GET', url: '/docs/json', ...remote });
      remoteStatuses.push(lastRemote.statusCode);
      for (let i = 0; i < 2; i++) {
        lastRemote = await limitedApp.inject({ method: 'GET', url: '/docs/json', ...remote });
        remoteStatuses.push(lastRemote.statusCode);
      }
      expect(remoteStatuses).toEqual([200, 200, 429]);
      expect(lastRemote.json()).toMatchObject({ error: { code: 'rate_limited' } });

      for (let i = 0; i < 3; i++) {
        const loopback = await limitedApp.inject({ method: 'GET', url: '/docs/json' });
        expect(loopback.statusCode).toBe(200);
        const health = await limitedApp.inject({ method: 'GET', url: '/health', ...remote });
        expect(health.statusCode).toBe(200);
      }
    });
  });

  // ── JSON request bodies ────────────────────────────────────────────────────

  // The macOS app sends Content-Type: application/json on every non-GET request, body or not.
  describe('JSON request bodies', () => {
    it.skipIf(!hasDb)('treats an empty JSON body as no body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/scrape-runs/999999999/cancel',
        headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
      });
      // The route's own 404 shows the request got past the body parser.
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
    });

    it('answers malformed or prototype-poisoned JSON with 400, not 500', async () => {
      for (const payload of ['{bad json', '{"__proto__": {"admin": true}}']) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/filters',
          headers: { ...AUTH_HEADER, 'content-type': 'application/json' },
          payload,
        });
        expect(res.statusCode).toBe(400);
        // Fastify's own code passes through in the standard envelope.
        expect(res.json()).toMatchObject({ error: { code: 'FST_ERR_CTP_INVALID_JSON_BODY' } });
      }
    });
  });

  describe('GET /metrics', () => {
    it('returns prometheus text format for loopback requests without auth in non-production', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/');
    });

    it('rejects non-loopback requests when no metrics token is configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '203.0.113.10',
      });
      expect(res.statusCode).toBe(403);
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

  describe('GET /metrics (disabled)', () => {
    let disabledApp: FastifyInstance;

    beforeAll(async () => {
      process.env.PROMETHEUS_ENABLED = 'false';
      resetConfig();
      disabledApp = await buildApp();
      await disabledApp.ready();
    });

    afterAll(async () => {
      await disabledApp.close();
      process.env.PROMETHEUS_ENABLED = 'true';
      resetConfig();
    });

    it('returns 404 when metrics are disabled', async () => {
      const res = await disabledApp.inject({
        method: 'GET',
        url: '/metrics',
      });
      expect(res.statusCode).toBe(404);
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
      expect(spec.info.title).toBe('ImmoRadar API');
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

  describe('PATCH /v1/sources/:id', () => {
    it.skipIf(!hasDb)('returns 409 when asked to switch on a legally disabled source', async () => {
      // The seed marks openimmo legally disabled.
      const [source] = await query<{ id: string }>(
        `SELECT id FROM sources WHERE code = 'openimmo'`,
      );
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/sources/${source!.id}`,
        headers: AUTH_HEADER,
        payload: { isActive: true },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: { code: 'conflict', message: expect.stringContaining('legally disabled') },
      });
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
