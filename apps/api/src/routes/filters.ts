import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@immoradar/observability';
import type { FilterCriteria, FilterUpdateInput, UserFilterRow } from '@immoradar/contracts';
import type { ListingSearchFilter } from '@immoradar/db';
import { userFilters, listings } from '@immoradar/db';
import { compileFilter } from '@immoradar/filtering';
import {
  parseOrThrow,
  idParamSchema,
  filterCreateSchema,
  filterUpdateSchema,
  carriesFilterCriteria,
  type FilterCriteriaFields,
} from '../schemas.js';
import { mapListingSearchResult } from './listings.js';

function centsToEur(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

function formatFilterResponse(filter: UserFilterRow) {
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

/** The criteria set of a validated create or update body. A field it lacks stays out. */
function toCriteria(fields: FilterCriteriaFields): FilterCriteria {
  return {
    operationType: fields.operationType,
    propertyTypes: fields.propertyTypes,
    districts: fields.districts,
    minPriceEur: fields.minPriceEur,
    maxPriceEur: fields.maxPriceEur,
    minAreaSqm: fields.minAreaSqm,
    maxAreaSqm: fields.maxAreaSqm,
    minRooms: fields.minRooms,
    maxRooms: fields.maxRooms,
    minScore: fields.minScore,
    requiredKeywords: fields.requiredKeywords,
    excludedKeywords: fields.excludedKeywords,
    sortBy: fields.sortBy,
  };
}

/** The caller's filter, or a 404 when it is missing, someone else's or deleted. */
async function findOwnedFilter(id: number, userId: number): Promise<UserFilterRow> {
  const filter = await userFilters.findById(id);
  if (!filter || filter.userId !== userId || filter.deletedAt != null) {
    throw new NotFoundError('Filter', id);
  }
  return filter;
}

export async function filterRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/filters - List user's filters, paused ones included
  app.get('/v1/filters', async (request, reply) => {
    const userId = request.userId;

    const filters = await userFilters.findByUserId(userId);

    return reply.send({
      data: filters.map(formatFilterResponse),
      meta: {},
    });
  });

  // POST /v1/filters - Create filter
  app.post(
    '/v1/filters',
    {
      schema: {
        tags: ['Filters'],
        summary: 'Create a saved filter',
        body: {
          type: 'object',
          required: ['name', 'filterKind'],
          additionalProperties: true,
          properties: {
            name: { type: 'string', description: 'Filter name' },
            filterKind: { type: 'string', description: 'listing_search or alert' },
            alertFrequency: {
              type: 'string',
              description: 'instant, hourly_digest, daily_digest, manual',
            },
            alertChannels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Channels: in_app, email, push, webhook',
            },
            operationType: { type: 'string', description: 'sale or rent' },
            propertyTypes: { type: 'array', items: { type: 'string' } },
            districts: { type: 'array', items: { type: 'number' } },
            minPriceEur: { type: 'number' },
            maxPriceEur: { type: 'number' },
            minAreaSqm: { type: 'number' },
            maxAreaSqm: { type: 'number' },
            minRooms: { type: 'number' },
            maxRooms: { type: 'number' },
            minScore: { type: 'number' },
            requiredKeywords: { type: 'array', items: { type: 'string' } },
            excludedKeywords: { type: 'array', items: { type: 'string' } },
            sortBy: {
              type: 'string',
              description: 'score_desc, newest, price_asc, price_desc, sqm_desc',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const validated = parseOrThrow(filterCreateSchema, request.body);

      const filter = await userFilters.create({
        userId,
        name: validated.name,
        filterKind: validated.filterKind,
        criteria: toCriteria(validated),
        alertFrequency: validated.alertFrequency,
        alertChannels: validated.alertChannels,
      });

      return reply.status(201).send({
        data: formatFilterResponse(filter),
        meta: {},
      });
    },
  );

  // GET /v1/filters/:id - Get filter
  app.get<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const filter = await findOwnedFilter(id, request.userId);

    return reply.send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // PATCH /v1/filters/:id - Update filter. Any criteria field replaces the whole criteria set.
  app.patch<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const validated = parseOrThrow(filterUpdateSchema, request.body);
    await findOwnedFilter(id, request.userId);

    const updateInput: FilterUpdateInput = {};
    if (validated.name !== undefined) updateInput.name = validated.name;
    if (validated.isActive !== undefined) updateInput.isActive = validated.isActive;
    if (validated.alertFrequency !== undefined) {
      updateInput.alertFrequency = validated.alertFrequency;
    }
    if (validated.alertChannels !== undefined) updateInput.alertChannels = validated.alertChannels;
    if (carriesFilterCriteria(request.body)) updateInput.criteria = toCriteria(validated);

    const filter = await userFilters.update(id, updateInput);
    if (!filter) {
      throw new NotFoundError('Filter', id);
    }

    return reply.send({
      data: formatFilterResponse(filter),
      meta: {},
    });
  });

  // POST /v1/filters/:id/test - Test a filter by running it against active listings
  app.post<{ Params: { id: string } }>('/v1/filters/:id/test', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    const filter = await findOwnedFilter(id, request.userId);

    // Reconstruct criteria from the stored filter columns
    const criteria: FilterCriteria = {};
    if (filter.operationType != null) criteria.operationType = filter.operationType;
    if (filter.propertyTypes.length > 0)
      criteria.propertyTypes = filter.propertyTypes as FilterCriteria['propertyTypes'];
    if (filter.districts.length > 0) criteria.districts = filter.districts;
    if (filter.minPriceEurCents != null) criteria.minPriceEur = filter.minPriceEurCents / 100;
    if (filter.maxPriceEurCents != null) criteria.maxPriceEur = filter.maxPriceEurCents / 100;
    if (filter.minAreaSqm != null) criteria.minAreaSqm = filter.minAreaSqm;
    if (filter.maxAreaSqm != null) criteria.maxAreaSqm = filter.maxAreaSqm;
    if (filter.minRooms != null) criteria.minRooms = filter.minRooms;
    if (filter.maxRooms != null) criteria.maxRooms = filter.maxRooms;
    if (filter.minScore != null) criteria.minScore = filter.minScore;
    if (filter.requiredKeywords.length > 0) criteria.requiredKeywords = filter.requiredKeywords;
    if (filter.excludedKeywords.length > 0) criteria.excludedKeywords = filter.excludedKeywords;
    criteria.sortBy = filter.sortBy;

    // Compile filter criteria to search parameters
    const compiled = compileFilter(criteria);

    // Execute listing search using the compiled filter
    const searchFilter: ListingSearchFilter = {
      operationType: compiled.operationType,
      propertyTypes: compiled.propertyTypes,
      districts: compiled.districts,
      minPriceEurCents: compiled.minPriceCents,
      maxPriceEurCents: compiled.maxPriceCents,
      minAreaSqm: compiled.minAreaSqm,
      maxAreaSqm: compiled.maxAreaSqm,
      minRooms: compiled.minRooms,
      maxRooms: compiled.maxRooms,
      minScore: compiled.minScore,
      requiredKeywords: compiled.requiredKeywords,
      excludedKeywords: compiled.excludedKeywords,
      sortBy: compiled.sortBy,
    };

    const result = await listings.searchListings(searchFilter, null);

    // The same DTO as listing search. The dashboard counts price drops among these matches
    // from lastPriceChangePct and lastPriceChangeAt, which come from listing_versions.
    return reply.send({
      data: result.data.map(mapListingSearchResult),
      meta: result.meta,
    });
  });

  // DELETE /v1/filters/:id - Soft delete: the filter leaves the list and stops alerting
  app.delete<{ Params: { id: string } }>('/v1/filters/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);
    await findOwnedFilter(id, request.userId);

    if (!(await userFilters.softDelete(id))) {
      throw new NotFoundError('Filter', id);
    }

    return reply.status(204).send();
  });
}
