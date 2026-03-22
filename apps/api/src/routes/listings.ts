import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@rei/observability';
import type { ListingSearchFilter } from '@rei/db';
import { listings, listingScores, listingVersions, clusters } from '@rei/db';
import {
  parseOrThrow,
  listingSearchQuerySchema,
  highScoreQuerySchema,
  idParamSchema,
  paginationQuerySchema,
} from '../schemas.js';

function eurToCents(eur: number | undefined): number | undefined {
  if (eur == null) return undefined;
  return Math.round(eur * 100);
}

function centsToEur(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/listings - Search listings with filter params
  app.get(
    '/v1/listings',
    {
      schema: {
        tags: ['Listings'],
        summary: 'Search listings with filters',
        querystring: {
          type: 'object',
          properties: {
            operationType: { type: 'string', description: 'sale or rent' },
            propertyTypes: {
              type: 'string',
              description: 'Comma-separated: apartment,house,land,commercial,parking,other',
            },
            districts: { type: 'string', description: 'Comma-separated district numbers' },
            minPriceEur: { type: 'number' },
            maxPriceEur: { type: 'number' },
            minAreaSqm: { type: 'number' },
            maxAreaSqm: { type: 'number' },
            minRooms: { type: 'number' },
            maxRooms: { type: 'number' },
            minScore: { type: 'number' },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'string' },
            sortBy: {
              type: 'string',
              description: 'score_desc, newest, price_asc, price_desc, sqm_desc',
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseOrThrow(listingSearchQuerySchema, request.query);

      const result = await listings.searchListings(
        {
          operationType: parsed.operationType as ListingSearchFilter['operationType'],
          propertyTypes: parsed.propertyTypes as ListingSearchFilter['propertyTypes'],
          districts: parsed.districts,
          minPriceEurCents: eurToCents(parsed.minPriceEur),
          maxPriceEurCents: eurToCents(parsed.maxPriceEur),
          minAreaSqm: parsed.minAreaSqm,
          maxAreaSqm: parsed.maxAreaSqm,
          minRooms: parsed.minRooms,
          maxRooms: parsed.maxRooms,
          minScore: parsed.minScore,
          sortBy: parsed.sortBy,
        },
        parsed.cursor ?? null,
        parsed.limit ?? undefined,
      );

      // Map cents to EUR for the API response
      const mappedData = result.data.map((listing) => ({
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
        latitude: listing.latitude,
        longitude: listing.longitude,
        geocodePrecision: listing.geocodePrecision,
      }));

      return reply.send({
        data: mappedData,
        meta: result.meta,
      });
    },
  );

  // GET /v1/listings/export - Export listings as CSV
  app.get(
    '/v1/listings/export',
    {
      schema: {
        tags: ['Listings'],
        summary: 'Export filtered listings as CSV',
        querystring: {
          type: 'object',
          properties: {
            operationType: { type: 'string' },
            propertyTypes: { type: 'string' },
            districts: { type: 'string' },
            minPriceEur: { type: 'number' },
            maxPriceEur: { type: 'number' },
            minAreaSqm: { type: 'number' },
            maxAreaSqm: { type: 'number' },
            minRooms: { type: 'number' },
            maxRooms: { type: 'number' },
            minScore: { type: 'number' },
            sortBy: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseOrThrow(listingSearchQuerySchema, request.query);

      const { csv, truncated } = await listings.exportListingsCsv({
        operationType: parsed.operationType as ListingSearchFilter['operationType'],
        propertyTypes: parsed.propertyTypes as ListingSearchFilter['propertyTypes'],
        districts: parsed.districts,
        minPriceEurCents: eurToCents(parsed.minPriceEur),
        maxPriceEurCents: eurToCents(parsed.maxPriceEur),
        minAreaSqm: parsed.minAreaSqm,
        maxAreaSqm: parsed.maxAreaSqm,
        minRooms: parsed.minRooms,
        maxRooms: parsed.maxRooms,
        minScore: parsed.minScore,
        sortBy: parsed.sortBy,
      });

      let disposition = reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="listings.csv"');
      if (truncated) {
        disposition = disposition.header('X-Truncated', 'true');
      }
      return disposition.send(csv);
    },
  );

  // GET /v1/listings/high-score - High-scoring listings
  app.get(
    '/v1/listings/high-score',
    {
      schema: {
        tags: ['Listings'],
        summary: 'Get high-scoring listings sorted by score descending',
        querystring: {
          type: 'object',
          properties: {
            minScore: { type: 'number', description: 'Minimum score threshold (default 70)' },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseOrThrow(highScoreQuerySchema, request.query);
      const minScore = parsed.minScore ?? 70;
      const limit = parsed.limit ?? 20;

      const result = await listings.searchListings(
        {
          minScore,
          sortBy: 'score_desc',
        },
        parsed.cursor ?? null,
        limit,
      );

      const mappedData = result.data.map((listing) => ({
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
        latitude: listing.latitude,
        longitude: listing.longitude,
        geocodePrecision: listing.geocodePrecision,
      }));

      return reply.send({
        data: mappedData,
        meta: result.meta,
      });
    },
  );

  // GET /v1/listings/:id - Get listing detail
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id',
    {
      schema: {
        tags: ['Listings'],
        summary: 'Get listing details by ID',
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

      const listing = await listings.findById(id);
      if (!listing) {
        throw new NotFoundError('Listing', id);
      }

      return reply.send({
        data: {
          id: listing.id,
          listingUid: listing.listingUid,
          sourceListingKey: listing.sourceListingKey,
          canonicalUrl: listing.canonicalUrl,
          operationType: listing.operationType,
          propertyType: listing.propertyType,
          propertySubtype: listing.propertySubtype,
          listingStatus: listing.listingStatus,
          title: listing.title,
          description: listing.description,
          city: listing.city,
          federalState: listing.federalState,
          postalCode: listing.postalCode,
          districtNo: listing.districtNo,
          districtName: listing.districtName,
          street: listing.street,
          houseNumber: listing.houseNumber,
          addressDisplay: listing.addressDisplay,
          latitude: listing.latitude,
          longitude: listing.longitude,
          geocodePrecision: listing.geocodePrecision,
          listPriceEur: centsToEur(listing.listPriceEurCents),
          listPriceEurCents: listing.listPriceEurCents,
          monthlyOperatingCostEur: centsToEur(listing.monthlyOperatingCostEurCents),
          reserveFundEur: centsToEur(listing.reserveFundEurCents),
          commissionEur: centsToEur(listing.commissionEurCents),
          livingAreaSqm: listing.livingAreaSqm,
          usableAreaSqm: listing.usableAreaSqm,
          balconyAreaSqm: listing.balconyAreaSqm,
          terraceAreaSqm: listing.terraceAreaSqm,
          gardenAreaSqm: listing.gardenAreaSqm,
          rooms: listing.rooms,
          floorLabel: listing.floorLabel,
          floorNumber: listing.floorNumber,
          yearBuilt: listing.yearBuilt,
          conditionCategory: listing.conditionCategory,
          heatingType: listing.heatingType,
          energyCertificateClass: listing.energyCertificateClass,
          hasBalcony: listing.hasBalcony,
          hasTerrace: listing.hasTerrace,
          hasGarden: listing.hasGarden,
          hasElevator: listing.hasElevator,
          parkingAvailable: listing.parkingAvailable,
          isFurnished: listing.isFurnished,
          pricePerSqmEur: listing.pricePerSqmEur,
          completenessScore: listing.completenessScore,
          currentScore: listing.currentScore,
          firstSeenAt: listing.firstSeenAt.toISOString(),
          lastSeenAt: listing.lastSeenAt.toISOString(),
          firstPublishedAt: listing.firstPublishedAt?.toISOString() ?? null,
          lastPriceChangeAt: listing.lastPriceChangeAt?.toISOString() ?? null,
          lastContentChangeAt: listing.lastContentChangeAt?.toISOString() ?? null,
          lastStatusChangeAt: listing.lastStatusChangeAt?.toISOString() ?? null,
          lastScoredAt: listing.lastScoredAt?.toISOString() ?? null,
        },
        meta: {},
      });
    },
  );

  // GET /v1/listings/:id/history - Get listing version history
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id/history',
    {
      schema: {
        tags: ['Listings'],
        summary: 'Get version history for a listing',
        params: {
          type: 'object',
          properties: { id: { type: 'integer' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 200,
              description: 'Max versions to return',
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);
      const { limit: queryLimit } = parseOrThrow(paginationQuerySchema, request.query);

      const versions = await listingVersions.findByListingId(id, queryLimit ?? 50);

      return reply.send({
        data: versions.map((v) => ({
          id: v.id,
          versionNo: v.versionNo,
          versionReason: v.versionReason,
          listingStatus: v.listingStatus,
          listPriceEurCents: v.listPriceEurCents,
          livingAreaSqm: v.livingAreaSqm,
          pricePerSqmEur: v.pricePerSqmEur,
          observedAt: v.observedAt.toISOString(),
        })),
        meta: {},
      });
    },
  );

  // GET /v1/listings/:id/score-explanation - Get score explanation
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id/score-explanation',
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);

      // Verify listing exists
      const listing = await listings.findById(id);
      if (!listing) {
        throw new NotFoundError('Listing', id);
      }

      const explanation = await listingScores.findLatestByListingId(id);
      if (!explanation) {
        throw new NotFoundError('Score explanation for listing', id);
      }

      return reply.send({
        data: {
          scoreVersion: explanation.scoreVersion,
          overallScore: explanation.overallScore,
          districtPriceScore: explanation.districtPriceScore,
          undervaluationScore: explanation.undervaluationScore,
          keywordSignalScore: explanation.keywordSignalScore,
          timeOnMarketScore: explanation.timeOnMarketScore,
          confidenceScore: explanation.confidenceScore,
          locationScore: explanation.locationScore,
          districtBaselinePpsqmEur: explanation.districtBaselinePpsqmEur,
          bucketBaselinePpsqmEur: explanation.bucketBaselinePpsqmEur,
          discountToDistrictPct: explanation.discountToDistrictPct,
          discountToBucketPct: explanation.discountToBucketPct,
          matchedPositiveKeywords: explanation.matchedPositiveKeywords,
          matchedNegativeKeywords: explanation.matchedNegativeKeywords,
          explanation: explanation.explanation,
        },
        meta: {},
      });
    },
  );

  // GET /v1/listings/:id/cluster - Get cross-source cluster
  app.get<{ Params: { id: string } }>(
    '/v1/listings/:id/cluster',
    {
      schema: {
        tags: ['Listings'],
        summary: 'Get cross-source cluster for a listing',
        params: {
          type: 'object',
          properties: { id: { type: 'integer' } },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);

      const cluster = await clusters.findClusterByListingId(id);
      if (!cluster || cluster.members.length < 2) {
        throw new NotFoundError('Cross-source cluster for listing', id);
      }

      return reply.send({
        data: {
          clusterId: cluster.id,
          fingerprint: cluster.fingerprint,
          listingCount: cluster.listingCount,
          priceSpreadPct: cluster.priceSpreadPct,
          members: cluster.members.map((m) => ({
            listingId: m.listingId,
            sourceCode: m.sourceCode,
            sourceName: m.sourceName,
            title: m.title,
            listPriceEur: m.listPriceEurCents != null ? m.listPriceEurCents / 100 : null,
            pricePerSqmEur: m.pricePerSqmEur,
            currentScore: m.currentScore,
            canonicalUrl: m.canonicalUrl,
            firstSeenAt: m.firstSeenAt.toISOString(),
          })),
        },
        meta: {},
      });
    },
  );
}
