import type { FastifyInstance } from 'fastify';
import { pois, wienDevelopments } from '@rei/db';
import { z } from 'zod';
import { parseOrThrow } from '../schemas.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(1).max(10000).default(500),
  categories: z
    .string()
    .transform((s) => {
      if (s === '') return undefined;
      return s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    })
    .optional(),
});

const poisQuerySchema = z.object({
  categories: z
    .string()
    .transform((s) => {
      if (s === '') return undefined;
      return s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    })
    .optional(),
});

export async function poiRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/pois - Returns all POIs (for client caching)
  app.get(
    '/v1/pois',
    {
      schema: {
        tags: ['POIs'],
        summary: 'Get all POIs for client-side caching',
        querystring: {
          type: 'object',
          properties: {
            categories: {
              type: 'string',
              description: 'Comma-separated: transit,park,school,police',
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseOrThrow(poisQuerySchema, request.query);
      const rows = await pois.findAll(parsed.categories);

      return reply.send({
        data: rows.map((poi) => ({
          id: poi.id,
          sourceId: poi.sourceId,
          externalKey: poi.externalKey,
          category: poi.category,
          subcategory: poi.subcategory,
          name: poi.name,
          latitude: poi.latitude,
          longitude: poi.longitude,
          districtNo: poi.districtNo,
          properties: poi.properties,
        })),
        meta: { count: rows.length },
      });
    },
  );

  // GET /v1/pois/nearby - Find POIs near a coordinate
  app.get(
    '/v1/pois/nearby',
    {
      schema: {
        tags: ['POIs'],
        summary: 'Find POIs near a coordinate with distances',
        querystring: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' },
            radius: {
              type: 'number',
              description: 'Search radius in meters (default 500, max 10000)',
            },
            categories: {
              type: 'string',
              description: 'Comma-separated: transit,park,school,police',
            },
          },
          required: ['lat', 'lon'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseOrThrow(nearbyQuerySchema, request.query);
      const rows = await pois.findNearby(parsed.lat, parsed.lon, parsed.radius, parsed.categories);

      return reply.send({
        data: rows.map((poi) => ({
          id: poi.id,
          sourceId: poi.sourceId,
          externalKey: poi.externalKey,
          category: poi.category,
          subcategory: poi.subcategory,
          name: poi.name,
          latitude: poi.latitude,
          longitude: poi.longitude,
          districtNo: poi.districtNo,
          properties: poi.properties,
          distanceM: poi.distanceM,
        })),
        meta: { count: rows.length },
      });
    },
  );

  // GET /v1/developments - Returns all Wien developments
  app.get(
    '/v1/developments',
    {
      schema: {
        tags: ['Developments'],
        summary: 'Get all Wien urban development projects',
      },
    },
    async (_request, reply) => {
      const rows = await wienDevelopments.findAll();

      return reply.send({
        data: rows.map((dev) => ({
          id: dev.id,
          externalKey: dev.externalKey,
          name: dev.name,
          status: dev.status,
          description: dev.description,
          category: dev.category,
          latitude: dev.latitude,
          longitude: dev.longitude,
          geometry: dev.geometry,
          sourceUrl: dev.sourceUrl,
          properties: dev.properties,
          fetchedAt: dev.fetchedAt.toISOString(),
        })),
        meta: { count: rows.length },
      });
    },
  );
}
