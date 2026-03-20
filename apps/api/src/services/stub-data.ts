import type {
  AlertRow,
  AlertStatus,
  ListingRow,
  ListingSearchResult,
  PaginatedResult,
  ScoreResult,
  SourceRow,
  UserFilterRow,
} from '@rei/contracts';

// ── Stub Listings ──────────────────────────────────────────────────────────

const now = new Date();
const oneDay = 86_400_000;

const STUB_LISTINGS: ListingSearchResult[] = [
  {
    id: 1,
    listingUid: '8c891f71-0cbc-4d9a-a3b8-a1af4fd5f2ea',
    sourceCode: 'willhaben',
    canonicalUrl: 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/1020-leopoldstadt/3-zimmer-eigentumswohnung-12345',
    title: '3-Zimmer Eigentumswohnung nahe Prater',
    operationType: 'sale',
    propertyType: 'apartment',
    city: 'Wien',
    postalCode: '1020',
    districtNo: 2,
    districtName: 'Leopoldstadt',
    listPriceEurCents: 29_900_000,
    livingAreaSqm: 58.4,
    rooms: 3,
    pricePerSqmEur: 5119.86,
    currentScore: 85.2,
    firstSeenAt: new Date(now.getTime() - 2 * oneDay),
    listingStatus: 'active',
  },
  {
    id: 2,
    listingUid: 'a2b3c4d5-e6f7-8901-2345-6789abcdef01',
    sourceCode: 'willhaben',
    canonicalUrl: 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/1030-landstrasse/renovierte-2-zimmer-67890',
    title: 'Renovierte 2-Zimmer-Wohnung in Landstrasse',
    operationType: 'sale',
    propertyType: 'apartment',
    city: 'Wien',
    postalCode: '1030',
    districtNo: 3,
    districtName: 'Landstrasse',
    listPriceEurCents: 24_500_000,
    livingAreaSqm: 52.0,
    rooms: 2,
    pricePerSqmEur: 4711.54,
    currentScore: 78.5,
    firstSeenAt: new Date(now.getTime() - 5 * oneDay),
    listingStatus: 'active',
  },
  {
    id: 3,
    listingUid: 'b3c4d5e6-f7a8-9012-3456-789abcdef012',
    sourceCode: 'willhaben',
    canonicalUrl: 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/1070-neubau/provisionsfrei-altbau-34567',
    title: 'Provisionsfrei! Altbau-Wohnung in Neubau',
    operationType: 'sale',
    propertyType: 'apartment',
    city: 'Wien',
    postalCode: '1070',
    districtNo: 7,
    districtName: 'Neubau',
    listPriceEurCents: 34_900_000,
    livingAreaSqm: 72.3,
    rooms: 3,
    pricePerSqmEur: 4827.11,
    currentScore: 91.0,
    firstSeenAt: new Date(now.getTime() - 1 * oneDay),
    listingStatus: 'active',
  },
  {
    id: 4,
    listingUid: 'c4d5e6f7-a8b9-0123-4567-89abcdef0123',
    sourceCode: 'willhaben',
    canonicalUrl: 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/1100-favoriten/grosse-4-zimmer-45678',
    title: 'Grosse 4-Zimmer-Wohnung in Favoriten',
    operationType: 'sale',
    propertyType: 'apartment',
    city: 'Wien',
    postalCode: '1100',
    districtNo: 10,
    districtName: 'Favoriten',
    listPriceEurCents: 19_900_000,
    livingAreaSqm: 85.0,
    rooms: 4,
    pricePerSqmEur: 2341.18,
    currentScore: 72.3,
    firstSeenAt: new Date(now.getTime() - 10 * oneDay),
    listingStatus: 'active',
  },
  {
    id: 5,
    listingUid: 'd5e6f7a8-b9c0-1234-5678-9abcdef01234',
    sourceCode: 'willhaben',
    canonicalUrl: 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/1090-alsergrund/dachgeschoss-56789',
    title: 'Dachgeschoss-Wohnung mit Terrasse, 9. Bezirk',
    operationType: 'sale',
    propertyType: 'apartment',
    city: 'Wien',
    postalCode: '1090',
    districtNo: 9,
    districtName: 'Alsergrund',
    listPriceEurCents: 52_000_000,
    livingAreaSqm: 95.0,
    rooms: 4,
    pricePerSqmEur: 5473.68,
    currentScore: 67.8,
    firstSeenAt: new Date(now.getTime() - 14 * oneDay),
    listingStatus: 'active',
  },
];

// ── Stub Listing Detail ────────────────────────────────────────────────────

function makeListingDetail(id: number): ListingRow | undefined {
  const search = STUB_LISTINGS.find((l) => l.id === id);
  if (!search) return undefined;

  return {
    id: search.id,
    listingUid: search.listingUid,
    sourceId: 1,
    sourceListingKey: `wh-${search.id}`,
    sourceExternalId: `${search.id * 1000}`,
    currentRawListingId: search.id,
    latestScrapeRunId: 1,
    canonicalUrl: search.canonicalUrl,
    operationType: search.operationType as ListingRow['operationType'],
    propertyType: search.propertyType as ListingRow['propertyType'],
    propertySubtype: null,
    listingStatus: search.listingStatus as ListingRow['listingStatus'],
    sourceStatusRaw: 'aktiv',
    title: search.title,
    description: 'Helle, freundliche Wohnung in zentraler Lage. Gute Anbindung an den oeffentlichen Nahverkehr.',
    districtNo: search.districtNo,
    districtName: search.districtName,
    postalCode: search.postalCode,
    city: search.city,
    federalState: 'Wien',
    street: null,
    houseNumber: null,
    addressDisplay: `${search.postalCode} Wien, ${search.districtName}`,
    latitude: 48.2082 + (search.id * 0.005),
    longitude: 16.3738 + (search.id * 0.005),
    geocodePrecision: 'district',
    crossSourceFingerprint: null,
    listPriceEurCents: search.listPriceEurCents,
    monthlyOperatingCostEurCents: 25_000,
    reserveFundEurCents: 5_000,
    commissionEurCents: null,
    livingAreaSqm: search.livingAreaSqm,
    usableAreaSqm: search.livingAreaSqm ? search.livingAreaSqm + 5 : null,
    balconyAreaSqm: null,
    terraceAreaSqm: null,
    gardenAreaSqm: null,
    rooms: search.rooms,
    floorLabel: '2. OG',
    floorNumber: 2,
    yearBuilt: 1905,
    conditionCategory: 'renoviert',
    heatingType: 'Fernwaerme',
    energyCertificateClass: 'C',
    hasBalcony: false,
    hasTerrace: search.id === 5,
    hasGarden: false,
    hasElevator: true,
    parkingAvailable: false,
    isFurnished: false,
    pricePerSqmEur: search.pricePerSqmEur,
    completenessScore: 85,
    currentScore: search.currentScore,
    normalizationVersion: 1,
    contentFingerprint: `fp-${search.id}`,
    normalizedPayload: {},
    firstSeenAt: search.firstSeenAt,
    lastSeenAt: now,
    firstPublishedAt: search.firstSeenAt,
    lastPriceChangeAt: null,
    lastContentChangeAt: null,
    lastStatusChangeAt: null,
    lastScoredAt: now,
    createdAt: search.firstSeenAt,
    updatedAt: now,
  };
}

// ── Stub Score Explanation ──────────────────────────────────────────────────

function makeScoreExplanation(id: number): ScoreResult | undefined {
  const search = STUB_LISTINGS.find((l) => l.id === id);
  if (!search) return undefined;

  const score = search.currentScore ?? 50;
  return {
    overallScore: score,
    districtPriceScore: Math.min(100, score + 8),
    undervaluationScore: Math.max(0, score - 5),
    keywordSignalScore: 68,
    timeOnMarketScore: 90,
    confidenceScore: 88,
    districtBaselinePpsqmEur: 6050,
    bucketBaselinePpsqmEur: 5700,
    discountToDistrictPct: search.pricePerSqmEur ? (6050 - search.pricePerSqmEur) / 6050 : null,
    discountToBucketPct: search.pricePerSqmEur ? (5700 - search.pricePerSqmEur) / 5700 : null,
    matchedPositiveKeywords: id === 3 ? ['provisionsfrei'] : [],
    matchedNegativeKeywords: [],
    explanation: {
      summary: 'Strong value opportunity in this district based on price-per-sqm relative to baseline.',
    },
    scoreVersion: 1,
  };
}

// ── Stub Filters ───────────────────────────────────────────────────────────

const STUB_FILTERS: UserFilterRow[] = [
  {
    id: 1,
    userId: 1,
    name: 'Vienna value apartments',
    filterKind: 'alert',
    isActive: true,
    operationType: 'sale',
    propertyTypes: ['apartment'],
    districts: [2, 3],
    postalCodes: [],
    minPriceEurCents: null,
    maxPriceEurCents: 30_000_000,
    minAreaSqm: 50,
    maxAreaSqm: null,
    minRooms: null,
    maxRooms: null,
    requiredKeywords: [],
    excludedKeywords: ['baurecht', 'unbefristet vermietet'],
    minScore: 70,
    sortBy: 'score_desc',
    alertFrequency: 'instant',
    alertChannels: ['in_app'],
    criteriaJson: {},
    lastEvaluatedAt: now,
    lastMatchAt: new Date(now.getTime() - oneDay),
    createdAt: new Date(now.getTime() - 30 * oneDay),
    updatedAt: now,
  },
  {
    id: 2,
    userId: 1,
    name: 'Cheap large flats',
    filterKind: 'listing_search',
    isActive: true,
    operationType: 'sale',
    propertyTypes: ['apartment'],
    districts: [],
    postalCodes: [],
    minPriceEurCents: null,
    maxPriceEurCents: 20_000_000,
    minAreaSqm: 80,
    maxAreaSqm: null,
    minRooms: 3,
    maxRooms: null,
    requiredKeywords: [],
    excludedKeywords: [],
    minScore: null,
    sortBy: 'price_asc',
    alertFrequency: 'daily_digest',
    alertChannels: ['in_app'],
    criteriaJson: {},
    lastEvaluatedAt: now,
    lastMatchAt: null,
    createdAt: new Date(now.getTime() - 15 * oneDay),
    updatedAt: now,
  },
];

// ── Stub Alerts ────────────────────────────────────────────────────────────

const STUB_ALERTS: AlertRow[] = [
  {
    id: 1,
    userId: 1,
    userFilterId: 1,
    listingId: 1,
    listingVersionId: 1,
    alertType: 'new_match',
    channel: 'in_app',
    status: 'sent',
    dedupeKey: 'filter:1:listing:1:type:new_match',
    title: 'New match: 3-Zimmer Eigentumswohnung nahe Prater',
    body: 'A new listing matched your filter "Vienna value apartments". Score: 85.2',
    payload: { listingId: 1, score: 85.2 },
    matchedAt: new Date(now.getTime() - 2 * oneDay),
    scheduledFor: new Date(now.getTime() - 2 * oneDay),
    sentAt: new Date(now.getTime() - 2 * oneDay),
    errorMessage: null,
    createdAt: new Date(now.getTime() - 2 * oneDay),
    updatedAt: new Date(now.getTime() - 2 * oneDay),
  },
  {
    id: 2,
    userId: 1,
    userFilterId: 1,
    listingId: 3,
    listingVersionId: 3,
    alertType: 'new_match',
    channel: 'in_app',
    status: 'sent',
    dedupeKey: 'filter:1:listing:3:type:new_match',
    title: 'New match: Provisionsfrei! Altbau-Wohnung in Neubau',
    body: 'A new listing matched your filter "Vienna value apartments". Score: 91.0',
    payload: { listingId: 3, score: 91.0 },
    matchedAt: new Date(now.getTime() - 1 * oneDay),
    scheduledFor: new Date(now.getTime() - 1 * oneDay),
    sentAt: new Date(now.getTime() - 1 * oneDay),
    errorMessage: null,
    createdAt: new Date(now.getTime() - 1 * oneDay),
    updatedAt: new Date(now.getTime() - 1 * oneDay),
  },
  {
    id: 3,
    userId: 1,
    userFilterId: 1,
    listingId: 2,
    listingVersionId: 2,
    alertType: 'price_drop',
    channel: 'in_app',
    status: 'sent',
    dedupeKey: 'filter:1:listing:2:type:price_drop',
    title: 'Price drop: Renovierte 2-Zimmer-Wohnung in Landstrasse',
    body: 'Price dropped from EUR 265,000 to EUR 245,000 (-7.5%)',
    payload: { listingId: 2, oldPriceEur: 265000, newPriceEur: 245000, dropPct: 7.5 },
    matchedAt: new Date(now.getTime() - 3 * oneDay),
    scheduledFor: new Date(now.getTime() - 3 * oneDay),
    sentAt: new Date(now.getTime() - 3 * oneDay),
    errorMessage: null,
    createdAt: new Date(now.getTime() - 3 * oneDay),
    updatedAt: new Date(now.getTime() - 3 * oneDay),
  },
];

// ── Stub Sources ───────────────────────────────────────────────────────────

const STUB_SOURCES: SourceRow[] = [
  {
    id: 1,
    code: 'willhaben',
    name: 'willhaben.at',
    baseUrl: 'https://www.willhaben.at',
    countryCode: 'AT',
    scrapeMode: 'browser',
    isActive: true,
    healthStatus: 'healthy',
    crawlIntervalMinutes: 15,
    priority: 1,
    rateLimitRpm: 12,
    concurrencyLimit: 1,
    parserVersion: 1,
    legalStatus: 'review_required',
    config: {},
    lastSuccessfulRunAt: new Date(now.getTime() - 900_000),
    createdAt: new Date(now.getTime() - 90 * oneDay),
    updatedAt: now,
  },
];

// ── Stub Scrape Runs ───────────────────────────────────────────────────────

interface StubScrapeRun {
  id: number;
  sourceId: number;
  sourceCode: string;
  status: string;
  scope: string;
  triggerType: string;
  seedName: string | null;
  pagesDiscovered: number;
  listingsDiscovered: number;
  listingsCaptured: number;
  listingsNew: number;
  listingsUpdated: number;
  listingsFailed: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const STUB_SCRAPE_RUNS: StubScrapeRun[] = [
  {
    id: 1,
    sourceId: 1,
    sourceCode: 'willhaben',
    status: 'succeeded',
    scope: 'full',
    triggerType: 'schedule',
    seedName: 'vienna_priority_buy_apartments',
    pagesDiscovered: 12,
    listingsDiscovered: 238,
    listingsCaptured: 238,
    listingsNew: 5,
    listingsUpdated: 14,
    listingsFailed: 0,
    startedAt: new Date(now.getTime() - 1_200_000),
    finishedAt: new Date(now.getTime() - 900_000),
    errorSummary: null,
    createdAt: new Date(now.getTime() - 1_200_000),
    updatedAt: new Date(now.getTime() - 900_000),
  },
  {
    id: 2,
    sourceId: 1,
    sourceCode: 'willhaben',
    status: 'running',
    scope: 'discovery',
    triggerType: 'schedule',
    seedName: 'vienna_priority_buy_apartments',
    pagesDiscovered: 3,
    listingsDiscovered: 60,
    listingsCaptured: 42,
    listingsNew: 1,
    listingsUpdated: 3,
    listingsFailed: 0,
    startedAt: new Date(now.getTime() - 120_000),
    finishedAt: null,
    errorSummary: null,
    createdAt: new Date(now.getTime() - 120_000),
    updatedAt: now,
  },
];

// ── Public Stub API ────────────────────────────────────────────────────────

let nextFilterId = STUB_FILTERS.length + 1;

export const stubData = {
  // Listings
  searchListings(params: {
    operationType?: string;
    propertyTypes?: string[];
    districts?: number[];
    minPriceCents?: number;
    maxPriceCents?: number;
    minAreaSqm?: number;
    maxAreaSqm?: number;
    minRooms?: number;
    maxRooms?: number;
    minScore?: number;
    sortBy?: string;
    limit?: number;
    cursor?: string;
  }): PaginatedResult<ListingSearchResult> {
    let results = [...STUB_LISTINGS];

    if (params.operationType) {
      results = results.filter((l) => l.operationType === params.operationType);
    }
    if (params.propertyTypes && params.propertyTypes.length > 0) {
      results = results.filter((l) => params.propertyTypes!.includes(l.propertyType));
    }
    if (params.districts && params.districts.length > 0) {
      results = results.filter((l) => l.districtNo != null && params.districts!.includes(l.districtNo));
    }
    if (params.minPriceCents != null) {
      results = results.filter((l) => l.listPriceEurCents != null && l.listPriceEurCents >= params.minPriceCents!);
    }
    if (params.maxPriceCents != null) {
      results = results.filter((l) => l.listPriceEurCents != null && l.listPriceEurCents <= params.maxPriceCents!);
    }
    if (params.minAreaSqm != null) {
      results = results.filter((l) => l.livingAreaSqm != null && l.livingAreaSqm >= params.minAreaSqm!);
    }
    if (params.maxAreaSqm != null) {
      results = results.filter((l) => l.livingAreaSqm != null && l.livingAreaSqm <= params.maxAreaSqm!);
    }
    if (params.minRooms != null) {
      results = results.filter((l) => l.rooms != null && l.rooms >= params.minRooms!);
    }
    if (params.maxRooms != null) {
      results = results.filter((l) => l.rooms != null && l.rooms <= params.maxRooms!);
    }
    if (params.minScore != null) {
      results = results.filter((l) => l.currentScore != null && l.currentScore >= params.minScore!);
    }

    // Sort
    const sort = params.sortBy ?? 'score_desc';
    switch (sort) {
      case 'score_desc':
        results.sort((a, b) => (b.currentScore ?? 0) - (a.currentScore ?? 0));
        break;
      case 'newest':
        results.sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime());
        break;
      case 'price_asc':
        results.sort((a, b) => (a.listPriceEurCents ?? 0) - (b.listPriceEurCents ?? 0));
        break;
      case 'price_desc':
        results.sort((a, b) => (b.listPriceEurCents ?? 0) - (a.listPriceEurCents ?? 0));
        break;
      case 'sqm_desc':
        results.sort((a, b) => (b.livingAreaSqm ?? 0) - (a.livingAreaSqm ?? 0));
        break;
    }

    const limit = params.limit ?? 50;
    const page = results.slice(0, limit);
    const hasMore = results.length > limit;

    return {
      data: page,
      meta: {
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ id: page[page.length - 1]?.id })).toString('base64') : null,
        pageSize: limit,
      },
    };
  },

  getListingById(id: number): ListingRow | undefined {
    return makeListingDetail(id);
  },

  getScoreExplanation(listingId: number): ScoreResult | undefined {
    return makeScoreExplanation(listingId);
  },

  // Filters
  listFilters(userId: number): UserFilterRow[] {
    return STUB_FILTERS.filter((f) => f.userId === userId && f.isActive);
  },

  getFilterById(id: number, userId: number): UserFilterRow | undefined {
    return STUB_FILTERS.find((f) => f.id === id && f.userId === userId);
  },

  createFilter(input: {
    userId: number;
    name: string;
    filterKind: string;
    criteria: Record<string, unknown>;
    alertFrequency: string;
    alertChannels: string[];
  }): UserFilterRow {
    const filter: UserFilterRow = {
      id: nextFilterId++,
      userId: input.userId,
      name: input.name,
      filterKind: input.filterKind as UserFilterRow['filterKind'],
      isActive: true,
      operationType: (input.criteria['operationType'] as UserFilterRow['operationType']) ?? null,
      propertyTypes: (input.criteria['propertyTypes'] as string[]) ?? [],
      districts: (input.criteria['districts'] as number[]) ?? [],
      postalCodes: (input.criteria['postalCodes'] as string[]) ?? [],
      minPriceEurCents: input.criteria['minPriceEur'] != null ? (input.criteria['minPriceEur'] as number) * 100 : null,
      maxPriceEurCents: input.criteria['maxPriceEur'] != null ? (input.criteria['maxPriceEur'] as number) * 100 : null,
      minAreaSqm: (input.criteria['minAreaSqm'] as number) ?? null,
      maxAreaSqm: (input.criteria['maxAreaSqm'] as number) ?? null,
      minRooms: (input.criteria['minRooms'] as number) ?? null,
      maxRooms: (input.criteria['maxRooms'] as number) ?? null,
      requiredKeywords: (input.criteria['requiredKeywords'] as string[]) ?? [],
      excludedKeywords: (input.criteria['excludedKeywords'] as string[]) ?? [],
      minScore: (input.criteria['minScore'] as number) ?? null,
      sortBy: (input.criteria['sortBy'] as UserFilterRow['sortBy']) ?? 'score_desc',
      alertFrequency: input.alertFrequency as UserFilterRow['alertFrequency'],
      alertChannels: input.alertChannels,
      criteriaJson: input.criteria,
      lastEvaluatedAt: null,
      lastMatchAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    STUB_FILTERS.push(filter);
    return filter;
  },

  updateFilter(id: number, userId: number, updates: Record<string, unknown>): UserFilterRow | undefined {
    const filter = STUB_FILTERS.find((f) => f.id === id && f.userId === userId);
    if (!filter) return undefined;

    if (updates['name'] != null) filter.name = updates['name'] as string;
    if (updates['isActive'] != null) filter.isActive = updates['isActive'] as boolean;
    if (updates['alertFrequency'] != null) filter.alertFrequency = updates['alertFrequency'] as UserFilterRow['alertFrequency'];
    if (updates['alertChannels'] != null) filter.alertChannels = updates['alertChannels'] as string[];
    filter.updatedAt = new Date();
    return filter;
  },

  softDeleteFilter(id: number, userId: number): boolean {
    const filter = STUB_FILTERS.find((f) => f.id === id && f.userId === userId);
    if (!filter) return false;
    filter.isActive = false;
    filter.updatedAt = new Date();
    return true;
  },

  // Alerts
  listAlerts(userId: number, params: { limit?: number; cursor?: string }): PaginatedResult<AlertRow> {
    const alerts = STUB_ALERTS.filter((a) => a.userId === userId);
    const limit = params.limit ?? 50;
    const page = alerts.slice(0, limit);
    return {
      data: page,
      meta: {
        nextCursor: null,
        pageSize: limit,
      },
    };
  },

  updateAlertStatus(id: number, userId: number, status: AlertStatus): AlertRow | undefined {
    const alert = STUB_ALERTS.find((a) => a.id === id && a.userId === userId);
    if (!alert) return undefined;
    alert.status = status;
    alert.updatedAt = new Date();
    return alert;
  },

  getUnreadAlertCount(userId: number): number {
    return STUB_ALERTS.filter((a) => a.userId === userId && a.status === 'sent').length;
  },

  // Sources
  listSources(): SourceRow[] {
    return STUB_SOURCES;
  },

  // Scrape Runs
  listScrapeRuns(_params: { limit?: number; cursor?: string }): PaginatedResult<StubScrapeRun> {
    return {
      data: STUB_SCRAPE_RUNS,
      meta: {
        nextCursor: null,
        pageSize: 50,
      },
    };
  },
};
