import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '@rei/observability';
import type { SortBy } from '@rei/contracts';
import type { ListingSearchFilter } from '@rei/db';
import { listings, listingScores } from '@rei/db';

const VALID_SORT_VALUES = new Set<string>(['score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc']);

function parseCommaSeparatedStrings(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseCommaSeparatedNumbers(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const nums = value.split(',').map((s) => {
    const n = parseInt(s.trim(), 10);
    if (Number.isNaN(n)) throw new ValidationError(`Invalid number in list: "${s.trim()}"`);
    return n;
  });
  return nums;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw new ValidationError(`Invalid number: "${String(value)}"`);
  return n;
}

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
  app.get('/v1/listings', async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    const operationType = query['operationType'] as string | undefined;
    const propertyTypes = parseCommaSeparatedStrings(query['propertyTypes']);
    const districts = parseCommaSeparatedNumbers(query['districts']);
    const minPriceEur = parseOptionalNumber(query['minPriceEur']);
    const maxPriceEur = parseOptionalNumber(query['maxPriceEur']);
    const minAreaSqm = parseOptionalNumber(query['minAreaSqm']);
    const maxAreaSqm = parseOptionalNumber(query['maxAreaSqm']);
    const minRooms = parseOptionalNumber(query['minRooms']);
    const maxRooms = parseOptionalNumber(query['maxRooms']);
    const minScore = parseOptionalNumber(query['minScore']);
    const limit = parseOptionalNumber(query['limit']);
    const cursor = query['cursor'] as string | undefined;

    const sortBy = (query['sortBy'] as string) ?? 'score_desc';
    if (!VALID_SORT_VALUES.has(sortBy)) {
      throw new ValidationError(`Invalid sortBy value: "${sortBy}". Valid: ${[...VALID_SORT_VALUES].join(', ')}`);
    }

    // Validate price range
    if (minPriceEur != null && maxPriceEur != null && minPriceEur > maxPriceEur) {
      throw new ValidationError('maxPriceEur must be greater than or equal to minPriceEur', {
        field: 'maxPriceEur',
      });
    }

    // Validate area range
    if (minAreaSqm != null && maxAreaSqm != null && minAreaSqm > maxAreaSqm) {
      throw new ValidationError('maxAreaSqm must be greater than or equal to minAreaSqm', {
        field: 'maxAreaSqm',
      });
    }

    // Validate room range
    if (minRooms != null && maxRooms != null && minRooms > maxRooms) {
      throw new ValidationError('maxRooms must be greater than or equal to minRooms', {
        field: 'maxRooms',
      });
    }

    if (limit != null && (limit < 1 || limit > 200)) {
      throw new ValidationError('limit must be between 1 and 200', { field: 'limit' });
    }

    const result = await listings.searchListings(
      {
        operationType: operationType as ListingSearchFilter['operationType'],
        propertyTypes: propertyTypes as ListingSearchFilter['propertyTypes'],
        districts,
        minPriceEurCents: eurToCents(minPriceEur),
        maxPriceEurCents: eurToCents(maxPriceEur),
        minAreaSqm,
        maxAreaSqm,
        minRooms,
        maxRooms,
        minScore,
        sortBy: sortBy as SortBy,
      },
      cursor ?? null,
      limit ?? undefined,
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
    }));

    return reply.send({
      data: mappedData,
      meta: result.meta,
    });
  });

  // GET /v1/listings/:id - Get listing detail
  app.get<{ Params: { id: string } }>('/v1/listings/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid listing id', { field: 'id' });
    }

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
  });

  // GET /v1/listings/:id/score-explanation - Get score explanation
  app.get<{ Params: { id: string } }>('/v1/listings/:id/score-explanation', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      throw new ValidationError('Invalid listing id', { field: 'id' });
    }

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
  });
}
