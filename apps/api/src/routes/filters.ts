import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@rei/observability';
import type { FilterKind, AlertFrequency, FilterCriteria, FilterUpdateInput } from '@rei/contracts';
import { userFilters } from '@rei/db';
import { parseOrThrow, idParamSchema, filterCreateSchema, filterUpdateSchema } from '../schemas.js';

function centsToEur(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

function formatFilterResponse(filter: {
  id: number;
  userId: number;
  name: string;
  filterKind: string;
  isActive: boolean;
  operationType: string | null;
  propertyTypes: string[];
  districts: number[];
  minPriceEurCents: number | null;
  maxPriceEurCents: number | null;
  minAreaSqm: number | null;
  maxAreaSqm: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  minScore: number | null;
  requiredKeywords: string[];
  excludedKeywords: string[];
  sortBy: string;
  alertFrequency: string;
  alertChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: filter.id,
    name: filter.name,
    filterKind: filter.filterKind,
    isActive: filter.isActive,
    operationType: filter.operationType,
    propertyTypes: filter.propertyTypes,
    districts: filter.districts,
    minPriceEur: centsToEur(filter.minPriceEurCents),
    maxPriceEur: centsToEur(filter.maxPriceEurCents),
    minAreaSqm: filter.minAreaSqm,
    maxAreaSqm: filter.maxAreaSqm,
    minRooms: filter.minRooms,
    maxRooms: filter.maxRooms,
    minScore: filter.minScore,
    requiredKeywords: filter.requiredKeywords,
    excludedKeywords: filter.excludedKeywords,
    sortBy: filter.sortBy,
    alertFrequency: filter.alertFrequency,
    alertChannels: filter.alertChannels,
    createdAt: filter.createdAt.toISOString(),
    updatedAt: filter.updatedAt.toISOString(),
  };
}

export async function filterRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/filters - List user's filters
  app.get('/v1/filters', async (request, reply) => {
    const userId = request.userId;

    const filters = await userFilters.findByUserId(userId);

    return reply.send({
      data: filters.map(formatFilterResponse),
      meta: {},
    });
  });

  // POST /v1/filters - Create filter
  app.post('/v1/filters', async (request, reply) => {
    const userId = request.userId;
    const validated = parseOrThrow(filterCreateSchema, request.body);

    const criteria: FilterCriteria = {};
    if (validated.operationType != null) criteria.operationType = validated.operationType;
    if (validated.propertyTypes != null) criteria.propertyTypes = validated.propertyTypes;
    if (validated.districts != null) criteria.districts = validated.districts;
    if (validated.minPriceEur != null) criteria.minPriceEur = validated.minPriceEur;
    if (validated.maxPriceEur != null) criteria.maxPriceEur = validated.maxPriceEur;
    if (validated.minAreaSqm != null) criteria.minAreaSqm = validated.minAreaSqm;
    if (validated.maxAreaSqm != null) criteria.maxAreaSqm = validated.maxAreaSqm;
    if (validated.minRooms != null) criteria.minRooms = validated.minRooms;
    if (validated.maxRooms != null) criteria.maxRooms = validated.maxRooms;
    if (validated.minScore != null) criteria.minScore = validated.minScore;
    if (validated.requiredKeywords != null) criteria.requiredKeywords = validated.requiredKeywords;
    if (validated.excludedKeywords != null) criteria.excludedKeywords = validated.excludedKeywords;
    if (validated.sortBy != null) criteria.sortBy = validated.sortBy;

    const filter = await userFilters.create({
      userId,
      name: validated.name,
      filterKind: validated.filterKind as FilterKind,
      criteria,
      alertFrequency: validated.alertFrequency as AlertFrequency,
      alertChannels: validated.alertChannels,
    });

    return reply.status(201).send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // GET /v1/filters/:id - Get filter
  app.get<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);

    const filter = await userFilters.findById(id);
    if (!filter || filter.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

    return reply.send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // PATCH /v1/filters/:id - Update filter
  app.patch<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const validated = parseOrThrow(filterUpdateSchema, request.body);

    // Verify ownership
    const existing = await userFilters.findById(id);
    if (!existing || existing.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

    const updateInput: FilterUpdateInput = {};
    if (validated.name !== undefined) updateInput.name = validated.name;
    if (validated.isActive !== undefined) updateInput.isActive = validated.isActive;
    if (validated.alertFrequency !== undefined) updateInput.alertFrequency = validated.alertFrequency as AlertFrequency;
    if (validated.alertChannels !== undefined) updateInput.alertChannels = validated.alertChannels;

    const filter = await userFilters.update(id, updateInput);
    if (!filter) {
      throw new NotFoundError('Filter', id);
    }

    return reply.send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // DELETE /v1/filters/:id - Soft delete (set is_active=false)
  app.delete<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);

    // Verify ownership
    const existing = await userFilters.findById(id);
    if (!existing || existing.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

    await userFilters.update(id, { isActive: false });

    return reply.status(204).send();
  });
}
