import type { FastifyInstance } from 'fastify';
import { feedback } from '@rei/db';
import { parseOrThrow, feedbackCreateSchema, idParamSchema } from '../schemas.js';

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/feedback - Upsert feedback for a listing
  app.post('/v1/feedback', async (request, reply) => {
    const { listingId, rating, notes } = parseOrThrow(feedbackCreateSchema, request.body);
    const row = await feedback.upsert(request.userId, listingId, rating, notes);

    return reply.status(201).send({
      data: {
        id: row.id,
        listingId: row.listingId,
        rating: row.rating,
        notes: row.notes,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      meta: {},
    });
  });

  // GET /v1/feedback/:id - Get feedback for a listing (by current user)
  app.get<{ Params: { id: string } }>('/v1/feedback/:id', async (request, reply) => {
    const { id: listingId } = parseOrThrow(idParamSchema, request.params);
    const row = await feedback.findByListing(listingId, request.userId);

    return reply.send({
      data: row
        ? {
            id: row.id,
            listingId: row.listingId,
            rating: row.rating,
            notes: row.notes,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }
        : null,
      meta: {},
    });
  });

  // DELETE /v1/feedback/:id - Remove feedback for a listing
  app.delete<{ Params: { id: string } }>('/v1/feedback/:id', async (request, reply) => {
    const { id: listingId } = parseOrThrow(idParamSchema, request.params);
    await feedback.remove(request.userId, listingId);
    return reply.status(204).send();
  });
}
