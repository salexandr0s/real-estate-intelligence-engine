import type { FastifyInstance } from 'fastify';
import { documents } from '@rei/db';
import { parseOrThrow, idParamSchema } from '../schemas.js';

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/listings/:id/documents - List documents for a listing
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id/documents',
    {
      schema: {
        tags: ['Documents'],
        summary: 'List documents attached to a listing',
        params: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Listing ID' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);

      try {
        const docs = await documents.findByListingId(id);

        const data = docs.map((doc) => ({
          id: doc.id,
          url: doc.url,
          documentType: doc.documentType,
          status: doc.status,
          mimeType: doc.mimeType,
          pageCount: doc.pageCount,
          label: doc.label,
          firstSeenAt: doc.firstSeenAt.toISOString(),
        }));

        return reply.send({ data, meta: {} });
      } catch {
        return reply.send({ data: [], meta: {} });
      }
    },
  );

  // GET /v1/documents/:id/facts - List extracted facts for a document
  app.get<{ Params: { id: string } }>(
    '/v1/documents/:id/facts',
    {
      schema: {
        tags: ['Documents'],
        summary: 'List extracted facts for a document',
        params: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Document ID' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);

      try {
        const facts = await documents.findFactsByDocumentId(id);

        const data = facts.map((fact) => ({
          id: fact.id,
          factType: fact.factType,
          factValue: fact.factValue,
          pageNumber: fact.pageNumber,
          confidence: fact.confidence,
          sourceSnippet: fact.sourceSnippet,
        }));

        return reply.send({ data, meta: {} });
      } catch {
        return reply.send({ data: [], meta: {} });
      }
    },
  );
}
