import type { FastifyInstance } from 'fastify';
import { savedListings } from '@immoradar/db';
import { parseOrThrow, idParamSchema, paginationQuerySchema } from '../schemas.js';
import { z } from 'zod';

const savedListingCreateSchema = z.object({
  listingId: z.number().int(),
  notes: z.string().optional(),
});

const savedListingCheckSchema = z.object({
  listingIds: z.string().transform((s) =>
    s
      .split(',')
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
  ),
});

function centsToEur(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

export async function savedListingRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/saved-listings — Save a listing
  app.post(
    '/v1/saved-listings',
    {
      schema: {
        tags: ['Watchlist'],
        summary: 'Save a listing to watchlist',
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { listingId, notes } = parseOrThrow(savedListingCreateSchema, request.body);
      const saved = await savedListings.save(userId, listingId, notes);
      return reply.code(201).send({ data: saved, meta: {} });
    },
  );

  // DELETE /v1/saved-listings/:id — Unsave a listing
  app.delete<{ Params: { id: string } }>(
    '/v1/saved-listings/:id',
    {
      schema: {
        tags: ['Watchlist'],
        summary: 'Remove a listing from watchlist',
        params: {
          type: 'object',
          properties: { id: { type: 'integer' } },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { id: listingId } = parseOrThrow(idParamSchema, request.params);
      await savedListings.unsave(userId, listingId);
      return reply.code(204).send();
    },
  );

  // GET /v1/saved-listings — List saved listings
  app.get(
    '/v1/saved-listings',
    {
      schema: {
        tags: ['Watchlist'],
        summary: 'List saved listings with full listing data',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { limit: queryLimit, cursor } = parseOrThrow(paginationQuerySchema, request.query);
      const result = await savedListings.findByUser(userId, queryLimit ?? 50, cursor ?? undefined);

      const mappedData = result.data.map((s) => ({
        id: s.id,
        listingId: s.listingId,
        notes: s.notes,
        savedAt: s.savedAt.toISOString(),
        listing: {
          id: s.listing.id,
          listingUid: s.listing.listingUid,
          sourceCode: s.listing.sourceCode,
          title: s.listing.title,
          canonicalUrl: s.listing.canonicalUrl,
          operationType: s.listing.operationType,
          propertyType: s.listing.propertyType,
          city: s.listing.city,
          districtNo: s.listing.districtNo,
          districtName: s.listing.districtName,
          listPriceEur: centsToEur(s.listing.listPriceEurCents),
          livingAreaSqm: s.listing.livingAreaSqm,
          rooms: s.listing.rooms,
          pricePerSqmEur: s.listing.pricePerSqmEur,
          currentScore: s.listing.currentScore,
          firstSeenAt: s.listing.firstSeenAt.toISOString(),
          listingStatus: s.listing.listingStatus,
        },
      }));

      return reply.send({
        data: mappedData,
        meta: { nextCursor: result.nextCursor },
      });
    },
  );

  // GET /v1/saved-listings/check — Check if listings are saved
  app.get(
    '/v1/saved-listings/check',
    {
      schema: {
        tags: ['Watchlist'],
        summary: 'Check if listings are in watchlist',
        querystring: {
          type: 'object',
          properties: {
            listingIds: { type: 'string', description: 'Comma-separated listing IDs' },
          },
          required: ['listingIds'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { listingIds } = parseOrThrow(savedListingCheckSchema, request.query);
      const savedIds = await savedListings.findSavedIds(userId, listingIds);
      return reply.send({ data: { savedIds: Array.from(savedIds) }, meta: {} });
    },
  );

  // GET /v1/saved-listings/export — Export saved listings as CSV
  app.get(
    '/v1/saved-listings/export',
    {
      schema: {
        tags: ['Watchlist'],
        summary: 'Export saved listings as CSV',
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const csv = await savedListings.exportCsv(userId);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="watchlist.csv"')
        .send(csv);
    },
  );
}
