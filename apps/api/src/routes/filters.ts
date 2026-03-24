import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@immoradar/observability';
import type {
  FilterKind,
  AlertFrequency,
  FilterCriteria,
  FilterUpdateInput,
} from '@immoradar/contracts';
import type { ListingSearchFilter } from '@immoradar/db';
import { userFilters, listings } from '@immoradar/db';
import { compileFilter } from '@immoradar/filtering';
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
      if (validated.requiredKeywords != null)
        criteria.requiredKeywords = validated.requiredKeywords;
      if (validated.excludedKeywords != null)
        criteria.excludedKeywords = validated.excludedKeywords;
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
    },
  );

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
    if (validated.alertFrequency !== undefined)
      updateInput.alertFrequency = validated.alertFrequency as AlertFrequency;
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

  // POST /v1/filters/:id/test - Test a filter by running it against active listings
  app.post<{ Params: { id: string } }>('/v1/filters/:id/test', async (request, reply) => {
    const { id } = parseOrThrow(idParamSchema, request.params);

    const filter = await userFilters.findById(id);
    if (!filter || filter.userId !== request.userId) {
      throw new NotFoundError('Filter', id);
    }

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
      sortBy: compiled.sortBy,
    };

    const result = await listings.searchListings(searchFilter, null);

    // Post-filter by keywords (searchListings doesn't support keyword params)
    const requiredKw = compiled.requiredKeywords ?? [];
    const excludedKw = compiled.excludedKeywords ?? [];
    const keywordFiltered = result.data.filter((listing) => {
      const text = (listing.title ?? '').toLowerCase();
      if (requiredKw.length > 0 && !requiredKw.every((kw) => text.includes(kw.toLowerCase())))
        return false;
      if (excludedKw.length > 0 && excludedKw.some((kw) => text.includes(kw.toLowerCase())))
        return false;
      return true;
    });

    const mappedData = keywordFiltered.map((listing) => ({
      id: listing.id,
      listingUid: listing.listingUid,
      sourceCode: listing.sourceCode,
      title: listing.title,
      canonicalUrl: listing.canonicalUrl,
      operationType: listing.operationType,
      propertyType: listing.propertyType,
      city: listing.city,
      postalCode: listing.postalCode,
      districtNo: listing.districtNo,
      districtName: listing.districtName,
      listPriceEur: centsToEur(listing.listPriceEurCents),
      listPriceEurCents: listing.listPriceEurCents,
      livingAreaSqm: listing.livingAreaSqm,
      rooms: listing.rooms,
      pricePerSqmEur: listing.pricePerSqmEur,
      currentScore: listing.currentScore,
      firstSeenAt: listing.firstSeenAt.toISOString(),
      listingStatus: listing.listingStatus,
    }));

    return reply.send({
      data: mappedData,
      meta: result.meta,
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
