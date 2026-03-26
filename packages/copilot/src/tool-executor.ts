// ── Tool executor ────────────────────────────────────────────────────────────
// Routes tool calls to existing @immoradar/db query functions and formats results
// into ContentBlock types for the Swift client + text summaries for Claude.

import {
  listings,
  listingScores,
  listingVersions,
  clusters,
  pois,
  listingPois,
  dashboard,
} from '@immoradar/db';
import { VIENNA_DISTRICTS } from '@immoradar/contracts';
import type {
  ContentBlock,
  ListingCardDTO,
  ScoreComponent,
  OperationType,
  PropertyType,
  SortBy,
  ListingRow,
  PoiCategoryCode,
} from '@immoradar/contracts';
import type { ToolResult } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function centsToEur(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

function eurToCents(eur: number | undefined): number | undefined {
  if (eur == null) return undefined;
  return Math.round(eur * 100);
}

function formatEur(eur: number | null): string {
  if (eur == null) return 'N/A';
  return `\u20AC ${eur.toLocaleString('de-AT', { maximumFractionDigits: 0 })}`;
}

function districtLabel(districtNo: number | null): string {
  if (districtNo == null) return 'Unknown';
  const d = VIENNA_DISTRICTS.find((v) => v.districtNo === districtNo);
  return d ? `${districtNo}. ${d.name}` : `District ${districtNo}`;
}

function listingToCardDTO(
  listing: ListingRow,
  priceTrendPct: number | null = null,
): ListingCardDTO {
  return {
    id: listing.id,
    title: listing.title,
    districtNo: listing.districtNo,
    districtName: listing.districtName,
    priceEur: centsToEur(listing.listPriceEurCents),
    areaSqm: listing.livingAreaSqm,
    rooms: listing.rooms,
    pricePerSqmEur: listing.pricePerSqmEur,
    score: listing.currentScore,
    canonicalUrl: listing.canonicalUrl,
    sourceCode: null,
    priceTrendPct,
  };
}

// ── Tool input type guards ──────────────────────────────────────────────────

interface SearchInput {
  operationType?: string;
  propertyTypes?: string[];
  districts?: number[];
  minPriceEur?: number;
  maxPriceEur?: number;
  minAreaSqm?: number;
  maxAreaSqm?: number;
  minRooms?: number;
  maxRooms?: number;
  minScore?: number;
  minLocationScore?: number;
  maxPoiDistances?: Record<string, number>;
  sortBy?: string;
}

interface ListingIdInput {
  listingId: number;
}

interface CompareInput {
  listingIds: number[];
}

interface MarketStatsInput {
  districtNo?: number;
  operationType?: string;
}

function asSearchInput(input: unknown): SearchInput {
  if (typeof input !== 'object' || input === null) return {};
  const obj = input as Record<string, unknown>;
  return {
    operationType: typeof obj.operationType === 'string' ? obj.operationType : undefined,
    propertyTypes: Array.isArray(obj.propertyTypes)
      ? obj.propertyTypes.filter((v): v is string => typeof v === 'string')
      : undefined,
    districts: Array.isArray(obj.districts)
      ? obj.districts.filter((v): v is number => typeof v === 'number')
      : undefined,
    minPriceEur: typeof obj.minPriceEur === 'number' ? obj.minPriceEur : undefined,
    maxPriceEur: typeof obj.maxPriceEur === 'number' ? obj.maxPriceEur : undefined,
    minAreaSqm: typeof obj.minAreaSqm === 'number' ? obj.minAreaSqm : undefined,
    maxAreaSqm: typeof obj.maxAreaSqm === 'number' ? obj.maxAreaSqm : undefined,
    minRooms: typeof obj.minRooms === 'number' ? obj.minRooms : undefined,
    maxRooms: typeof obj.maxRooms === 'number' ? obj.maxRooms : undefined,
    minScore: typeof obj.minScore === 'number' ? obj.minScore : undefined,
    minLocationScore: typeof obj.minLocationScore === 'number' ? obj.minLocationScore : undefined,
    maxPoiDistances: parsePoiDistances(obj.maxPoiDistances),
    sortBy: typeof obj.sortBy === 'string' ? obj.sortBy : undefined,
  };
}

const VALID_POI_CATEGORIES = new Set([
  'ubahn',
  'tram',
  'bus',
  'park',
  'school',
  'supermarket',
  'hospital',
  'doctor',
  'police',
  'fire_station',
  'taxi',
]);

function parsePoiDistances(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (VALID_POI_CATEGORIES.has(key) && typeof val === 'number' && val > 0) {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function asListingIdInput(input: unknown): ListingIdInput | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  const id = Number(obj.listingId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { listingId: id };
}

function asCompareInput(input: unknown): CompareInput {
  if (typeof input !== 'object' || input === null) return { listingIds: [] };
  const obj = input as Record<string, unknown>;
  const ids = obj.listingIds;
  if (!Array.isArray(ids)) return { listingIds: [] };
  return {
    listingIds: ids.filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
    ),
  };
}

function asMarketStatsInput(input: unknown): MarketStatsInput {
  if (typeof input !== 'object' || input === null) return {};
  const obj = input as Record<string, unknown>;
  return {
    districtNo: typeof obj.districtNo === 'number' ? obj.districtNo : undefined,
    operationType: typeof obj.operationType === 'string' ? obj.operationType : undefined,
  };
}

function requireListingId(input: unknown): { listingId: number } | ToolResult {
  const parsed = asListingIdInput(input);
  if (!parsed) {
    return {
      contentBlock: { type: 'text', text: 'Invalid or missing listingId parameter.' },
      rawForClaude:
        'Error: invalid or missing listingId. Please provide a valid listing ID number.',
    };
  }
  return parsed;
}

// ── Executors ───────────────────────────────────────────────────────────────

async function executeSearchListings(input: unknown): Promise<ToolResult> {
  const params = asSearchInput(input);

  const result = await listings.searchListings(
    {
      operationType: (params.operationType as OperationType) ?? undefined,
      propertyTypes: (params.propertyTypes as PropertyType[]) ?? undefined,
      districts: params.districts,
      minPriceEurCents: eurToCents(params.minPriceEur),
      maxPriceEurCents: eurToCents(params.maxPriceEur),
      minAreaSqm: params.minAreaSqm,
      maxAreaSqm: params.maxAreaSqm,
      minRooms: params.minRooms,
      maxRooms: params.maxRooms,
      minScore: params.minScore,
      minLocationScore: params.minLocationScore,
      maxPoiDistances: params.maxPoiDistances,
      sortBy: (params.sortBy as SortBy) ?? 'score_desc',
    },
    null,
    10,
  );

  const cards: ListingCardDTO[] = result.data.map((l) => ({
    id: l.id,
    title: l.title,
    districtNo: l.districtNo,
    districtName: l.districtName,
    priceEur: centsToEur(l.listPriceEurCents),
    areaSqm: l.livingAreaSqm,
    rooms: l.rooms,
    pricePerSqmEur: l.pricePerSqmEur,
    score: l.currentScore,
    canonicalUrl: l.canonicalUrl,
    sourceCode: l.sourceCode ?? null,
    priceTrendPct: l.lastPriceChangePct,
  }));

  const block: ContentBlock = { type: 'listing_cards', listings: cards };

  const lines = cards.map(
    (c) =>
      `- ID ${c.id}: "${c.title}" in ${districtLabel(c.districtNo)} | ${formatEur(c.priceEur)} | ${c.areaSqm ?? '?'}sqm | ${c.rooms ?? '?'} rooms | Score: ${c.score ?? 'N/A'}${c.priceTrendPct != null ? ` | Price trend: ${c.priceTrendPct > 0 ? '+' : ''}${c.priceTrendPct.toFixed(1)}%` : ''}`,
  );

  const rawForClaude = `Found ${result.meta.totalCount} total matches (showing top ${cards.length}):\n${lines.join('\n')}`;

  return { contentBlock: block, rawForClaude };
}

async function executeGetListingDetail(input: unknown): Promise<ToolResult> {
  const parsed = requireListingId(input);
  if ('rawForClaude' in parsed) return parsed;
  const { listingId } = parsed;
  const listing = await listings.findById(listingId);
  if (!listing) {
    return {
      contentBlock: { type: 'text', text: `Listing ${listingId} not found.` },
      rawForClaude: `Listing ${listingId} not found.`,
    };
  }

  const card = listingToCardDTO(listing);
  const block: ContentBlock = { type: 'listing_cards', listings: [card] };

  const priceEur = centsToEur(listing.listPriceEurCents);
  const rawForClaude = [
    `Listing #${listing.id}: "${listing.title}"`,
    `Location: ${listing.addressDisplay ?? ''}, ${districtLabel(listing.districtNo)}, ${listing.postalCode ?? ''}`,
    `Type: ${listing.operationType} / ${listing.propertyType}`,
    `Price: ${formatEur(priceEur)} | Price/sqm: ${formatEur(listing.pricePerSqmEur)}`,
    `Area: ${listing.livingAreaSqm ?? '?'}sqm living, ${listing.usableAreaSqm ?? '?'}sqm usable`,
    `Rooms: ${listing.rooms ?? '?'} | Floor: ${listing.floorLabel ?? '?'} | Year built: ${listing.yearBuilt ?? '?'}`,
    `Score: ${listing.currentScore ?? 'Not scored'}`,
    `Status: ${listing.listingStatus} | First seen: ${listing.firstSeenAt.toISOString().slice(0, 10)}`,
    `Features: balcony=${listing.hasBalcony}, terrace=${listing.hasTerrace}, garden=${listing.hasGarden}, elevator=${listing.hasElevator}, parking=${listing.parkingAvailable}`,
    `URL: ${listing.canonicalUrl}`,
  ].join('\n');

  return { contentBlock: block, rawForClaude };
}

async function executeGetScoreExplanation(input: unknown): Promise<ToolResult> {
  const parsed = requireListingId(input);
  if ('rawForClaude' in parsed) return parsed;
  const { listingId } = parsed;

  const [listing, score] = await Promise.all([
    listings.findById(listingId),
    listingScores.findLatestByListingId(listingId),
  ]);

  if (!listing) {
    return {
      contentBlock: { type: 'text', text: `Listing ${listingId} not found.` },
      rawForClaude: `Listing ${listingId} not found.`,
    };
  }

  if (!score) {
    return {
      contentBlock: { type: 'text', text: `No score available for listing ${listingId}.` },
      rawForClaude: `No score available for listing ${listingId}.`,
    };
  }

  const components: ScoreComponent[] = [
    { name: 'districtPrice', score: score.districtPriceScore, weight: 25, label: 'District Price' },
    {
      name: 'undervaluation',
      score: score.undervaluationScore,
      weight: 25,
      label: 'Undervaluation',
    },
    {
      name: 'keywordSignal',
      score: score.keywordSignalScore,
      weight: 15,
      label: 'Keyword Signals',
    },
    {
      name: 'timeOnMarket',
      score: score.timeOnMarketScore,
      weight: 10,
      label: 'Time on Market',
    },
    { name: 'confidence', score: score.confidenceScore, weight: 10, label: 'Confidence' },
    { name: 'location', score: score.locationScore, weight: 15, label: 'Location' },
  ];

  const block: ContentBlock = {
    type: 'score_breakdown',
    listingId,
    listingTitle: listing.title,
    overallScore: score.overallScore,
    components,
    discountToDistrictPct: score.discountToDistrictPct,
    discountToBucketPct: score.discountToBucketPct,
    positiveKeywords: score.matchedPositiveKeywords,
    negativeKeywords: score.matchedNegativeKeywords,
  };

  const rawForClaude = [
    `Score breakdown for listing #${listingId} "${listing.title}":`,
    `Overall score: ${score.overallScore}/100`,
    ...components.map((c) => `  ${c.label}: ${c.score}/100 (weight: ${c.weight}%)`),
    `District baseline: ${score.districtBaselinePpsqmEur != null ? formatEur(score.districtBaselinePpsqmEur) + '/sqm' : 'N/A'}`,
    `Bucket baseline: ${score.bucketBaselinePpsqmEur != null ? formatEur(score.bucketBaselinePpsqmEur) + '/sqm' : 'N/A'}`,
    `Discount to district: ${score.discountToDistrictPct != null ? score.discountToDistrictPct.toFixed(1) + '%' : 'N/A'}`,
    `Discount to bucket: ${score.discountToBucketPct != null ? score.discountToBucketPct.toFixed(1) + '%' : 'N/A'}`,
    `Positive keywords: ${score.matchedPositiveKeywords.length > 0 ? score.matchedPositiveKeywords.join(', ') : 'none'}`,
    `Negative keywords: ${score.matchedNegativeKeywords.length > 0 ? score.matchedNegativeKeywords.join(', ') : 'none'}`,
  ].join('\n');

  return { contentBlock: block, rawForClaude };
}

type CompareFound = {
  listing: ListingRow;
  score: Awaited<ReturnType<typeof listingScores.findLatestByListingId>>;
};

type ComparisonMetricSpec = {
  label: string;
  formatter: (entry: CompareFound) => string | null;
  numericValue?: (entry: CompareFound) => number | null;
  better?: 'higher' | 'lower';
};

const POI_CATEGORY_LABELS: Record<PoiCategoryCode, string> = {
  ubahn: 'U-Bahn',
  tram: 'Tram',
  bus: 'Bus',
  taxi: 'Taxi',
  park: 'Park',
  school: 'School',
  supermarket: 'Supermarket',
  hospital: 'Hospital',
  doctor: 'Doctor',
  police: 'Police',
  fire_station: 'Fire Station',
};

const PROXIMITY_COUNT_SPECS: Array<{
  category: PoiCategoryCode;
  label: string;
  withinMeters: number;
}> = [
  { category: 'supermarket', label: 'Supermarkets within 500m', withinMeters: 500 },
  { category: 'park', label: 'Parks within 500m', withinMeters: 500 },
  { category: 'school', label: 'Schools within 500m', withinMeters: 500 },
  { category: 'doctor', label: 'Doctors within 500m', withinMeters: 500 },
  { category: 'hospital', label: 'Hospitals within 2km', withinMeters: 2000 },
  { category: 'police', label: 'Police within 1km', withinMeters: 1000 },
  { category: 'fire_station', label: 'Fire stations within 1km', withinMeters: 1000 },
];

function formatNumeric(value: number, maximumFractionDigits = 1): string {
  return value.toLocaleString('de-AT', { maximumFractionDigits });
}

function formatMaybeEur(eur: number | null): string | null {
  return eur == null ? null : formatEur(eur);
}

function formatMaybePerSqm(eur: number | null): string | null {
  return eur == null ? null : `${formatEur(eur)}/m²`;
}

function formatMaybePercent(value: number | null): string | null {
  return value == null ? null : `${value.toFixed(1)}%`;
}

function formatMaybeDecimal(value: number | null, suffix = ''): string | null {
  return value == null ? null : `${formatNumeric(value)}${suffix}`;
}

function findExtremeListingId(
  entries: CompareFound[],
  selector: (entry: CompareFound) => number | null,
  better: 'higher' | 'lower',
): number | null {
  let chosenId: number | null = null;
  let chosenValue: number | null = null;

  for (const entry of entries) {
    const value = selector(entry);
    if (value == null) continue;
    if (chosenValue == null || (better === 'higher' ? value > chosenValue : value < chosenValue)) {
      chosenValue = value;
      chosenId = entry.listing.id;
    }
  }

  return chosenId;
}

function buildComparisonMetric(
  entries: CompareFound[],
  spec: ComparisonMetricSpec,
): {
  label: string;
  values: Array<{
    listingId: number;
    value: string | null;
    emphasis?: 'best' | 'weakest' | 'neutral';
  }>;
} {
  const bestId =
    spec.numericValue && spec.better
      ? findExtremeListingId(entries, spec.numericValue, spec.better)
      : null;
  const weakestId =
    spec.numericValue && spec.better
      ? findExtremeListingId(
          entries,
          spec.numericValue,
          spec.better === 'higher' ? 'lower' : 'higher',
        )
      : null;

  return {
    label: spec.label,
    values: entries.map((entry) => {
      const emphasis =
        entry.listing.id === bestId
          ? 'best'
          : entry.listing.id === weakestId
            ? 'weakest'
            : undefined;
      return {
        listingId: entry.listing.id,
        value: spec.formatter(entry),
        emphasis,
      };
    }),
  };
}

async function executeCompareListings(input: unknown): Promise<ToolResult> {
  const { listingIds } = asCompareInput(input);

  const results = await Promise.all(
    listingIds.map(async (id) => {
      const [listing, score] = await Promise.all([
        listings.findById(id),
        listingScores.findLatestByListingId(id),
      ]);
      return { listing, score };
    }),
  );

  const found = results.filter((result): result is CompareFound => result.listing != null);

  if (found.length < 2) {
    return {
      contentBlock: {
        type: 'text',
        text: `Could not find enough listings to compare. Found ${found.length} of ${listingIds.length} requested.`,
      },
      rawForClaude: `Could not find enough listings to compare. Only ${found.length} found.`,
    };
  }

  const listingsPayload = found.map((entry) => listingToCardDTO(entry.listing));

  const sections = [
    {
      title: 'Value',
      metrics: [
        buildComparisonMetric(found, {
          label: 'Price',
          formatter: (entry) => formatMaybeEur(centsToEur(entry.listing.listPriceEurCents)),
          numericValue: (entry) => centsToEur(entry.listing.listPriceEurCents),
          better: 'lower',
        }),
        buildComparisonMetric(found, {
          label: 'Price / m²',
          formatter: (entry) => formatMaybePerSqm(entry.listing.pricePerSqmEur),
          numericValue: (entry) => entry.listing.pricePerSqmEur,
          better: 'lower',
        }),
        buildComparisonMetric(found, {
          label: 'Discount vs district',
          formatter: (entry) => formatMaybePercent(entry.score?.discountToDistrictPct ?? null),
          numericValue: (entry) => entry.score?.discountToDistrictPct ?? null,
          better: 'lower',
        }),
        buildComparisonMetric(found, {
          label: 'Undervaluation',
          formatter: (entry) => formatMaybeDecimal(entry.score?.undervaluationScore ?? null),
          numericValue: (entry) => entry.score?.undervaluationScore ?? null,
          better: 'higher',
        }),
      ],
    },
    {
      title: 'Profile',
      metrics: [
        buildComparisonMetric(found, {
          label: 'Area',
          formatter: (entry) => formatMaybeDecimal(entry.listing.livingAreaSqm, ' m²'),
          numericValue: (entry) => entry.listing.livingAreaSqm,
          better: 'higher',
        }),
        buildComparisonMetric(found, {
          label: 'Rooms',
          formatter: (entry) => formatMaybeDecimal(entry.listing.rooms),
          numericValue: (entry) => entry.listing.rooms,
          better: 'higher',
        }),
        buildComparisonMetric(found, {
          label: 'District',
          formatter: (entry) => districtLabel(entry.listing.districtNo),
        }),
        buildComparisonMetric(found, {
          label: 'Status',
          formatter: (entry) => entry.listing.listingStatus,
        }),
      ],
    },
    {
      title: 'Quality',
      metrics: [
        buildComparisonMetric(found, {
          label: 'Score',
          formatter: (entry) => formatMaybeDecimal(entry.listing.currentScore),
          numericValue: (entry) => entry.listing.currentScore,
          better: 'higher',
        }),
        buildComparisonMetric(found, {
          label: 'Location score',
          formatter: (entry) => formatMaybeDecimal(entry.score?.locationScore ?? null),
          numericValue: (entry) => entry.score?.locationScore ?? null,
          better: 'higher',
        }),
        buildComparisonMetric(found, {
          label: 'Confidence',
          formatter: (entry) => formatMaybeDecimal(entry.score?.confidenceScore ?? null),
          numericValue: (entry) => entry.score?.confidenceScore ?? null,
          better: 'higher',
        }),
        buildComparisonMetric(found, {
          label: 'Year built',
          formatter: (entry) =>
            entry.listing.yearBuilt != null ? String(entry.listing.yearBuilt) : null,
          numericValue: (entry) => entry.listing.yearBuilt,
          better: 'higher',
        }),
      ],
    },
  ];

  const highestScore = found
    .filter((entry) => entry.listing.currentScore != null)
    .sort((lhs, rhs) => (rhs.listing.currentScore ?? 0) - (lhs.listing.currentScore ?? 0))[0];
  const lowestPpsqm = found
    .filter((entry) => entry.listing.pricePerSqmEur != null)
    .sort((lhs, rhs) => (lhs.listing.pricePerSqmEur ?? 0) - (rhs.listing.pricePerSqmEur ?? 0))[0];
  const biggestDiscount = found
    .filter((entry) => entry.score?.discountToDistrictPct != null)
    .sort(
      (lhs, rhs) =>
        (lhs.score?.discountToDistrictPct ?? 0) - (rhs.score?.discountToDistrictPct ?? 0),
    )[0];

  const callouts = [
    highestScore
      ? {
          label: 'Highest score',
          detail: `#${highestScore.listing.id} leads at ${formatNumeric(highestScore.listing.currentScore ?? 0)}.`,
          listingId: highestScore.listing.id,
          tone: 'positive' as const,
        }
      : null,
    lowestPpsqm
      ? {
          label: 'Best unit economics',
          detail: `#${lowestPpsqm.listing.id} is lowest at ${formatMaybePerSqm(lowestPpsqm.listing.pricePerSqmEur) ?? 'N/A'}.`,
          listingId: lowestPpsqm.listing.id,
          tone: 'positive' as const,
        }
      : null,
    biggestDiscount
      ? {
          label: 'Biggest district discount',
          detail: `#${biggestDiscount.listing.id} sits ${formatMaybePercent(biggestDiscount.score?.discountToDistrictPct ?? null) ?? 'N/A'} vs district baseline.`,
          listingId: biggestDiscount.listing.id,
          tone: 'neutral' as const,
        }
      : null,
  ].filter((callout): callout is NonNullable<typeof callout> => callout != null);

  const block: ContentBlock = {
    type: 'listing_comparison',
    listings: listingsPayload,
    sections,
    callouts,
  };

  const rawForClaude = [
    `Comparison of ${found.length} listings:`,
    ...sections.flatMap((section) => [
      `${section.title}:`,
      ...section.metrics.map((metric) => {
        const values = metric.values
          .map((value) => `#${value.listingId} ${value.value ?? 'N/A'}`)
          .join(' | ');
        return `  ${metric.label}: ${values}`;
      }),
    ]),
    ...callouts.map((callout) => `${callout.label}: ${callout.detail}`),
  ].join('\n');

  return { contentBlock: block, rawForClaude };
}

async function executeGetPriceHistory(input: unknown): Promise<ToolResult> {
  const parsed = requireListingId(input);
  if ('rawForClaude' in parsed) return parsed;
  const { listingId } = parsed;

  const [listing, versions] = await Promise.all([
    listings.findById(listingId),
    listingVersions.findByListingId(listingId, 50),
  ]);

  if (!listing) {
    return {
      contentBlock: { type: 'text', text: `Listing ${listingId} not found.` },
      rawForClaude: `Listing ${listingId} not found.`,
    };
  }

  if (versions.length === 0) {
    return {
      contentBlock: { type: 'text', text: `No version history for listing ${listingId}.` },
      rawForClaude: `No version history for listing ${listingId}.`,
    };
  }

  const chronological = [...versions].reverse();

  const dataPoints = chronological
    .filter((v): v is typeof v & { listPriceEurCents: number } => v.listPriceEurCents != null)
    .map((v) => ({
      date: v.observedAt.toISOString().slice(0, 10),
      priceEur: v.listPriceEurCents / 100,
      reason: v.versionReason,
    }));

  const block: ContentBlock = {
    type: 'price_history',
    listingId,
    listingTitle: listing.title,
    dataPoints,
  };

  const rawLines = dataPoints.map((dp) => `  ${dp.date}: ${formatEur(dp.priceEur)} (${dp.reason})`);
  const rawForClaude = `Price history for listing #${listingId} "${listing.title}":\n${rawLines.join('\n')}`;

  return { contentBlock: block, rawForClaude };
}

async function executeGetMarketStats(input: unknown): Promise<ToolResult> {
  const params = asMarketStatsInput(input);

  const globalStats = await dashboard.getStats();

  const stats: { label: string; value: string | number; trend?: 'up' | 'down' | 'flat' }[] = [
    { label: 'Total Active Listings', value: globalStats.totalActive },
    {
      label: 'New Today',
      value: globalStats.newToday,
      trend: globalStats.newToday > 0 ? 'up' : 'flat',
    },
    { label: 'High Score (70+)', value: globalStats.highScore70 },
  ];

  if (params.districtNo != null) {
    const districtResult = await listings.searchListings(
      {
        districts: [params.districtNo],
        operationType: (params.operationType as OperationType) ?? undefined,
      },
      null,
      1,
    );

    stats.push({
      label: `Active in ${districtLabel(params.districtNo)}`,
      value: districtResult.meta.totalCount ?? 0,
    });

    const scoredResult = await listings.searchListings(
      {
        districts: [params.districtNo],
        operationType: (params.operationType as OperationType) ?? undefined,
        minScore: 70,
      },
      null,
      1,
    );

    stats.push({
      label: `High Score in ${districtLabel(params.districtNo)}`,
      value: scoredResult.meta.totalCount ?? 0,
    });
  }

  const block: ContentBlock = { type: 'market_stats', stats };

  const rawLines = stats.map(
    (s) => `  ${s.label}: ${s.value}${s.trend ? ` (trend: ${s.trend})` : ''}`,
  );
  const rawForClaude = `Market statistics:\n${rawLines.join('\n')}`;

  return { contentBlock: block, rawForClaude };
}

async function executeGetNearbyPois(input: unknown): Promise<ToolResult> {
  const parsed = requireListingId(input);
  if ('rawForClaude' in parsed) return parsed;
  const { listingId } = parsed;

  const listing = await listings.findById(listingId);
  if (!listing) {
    return {
      contentBlock: { type: 'text', text: `Listing ${listingId} not found.` },
      rawForClaude: `Listing ${listingId} not found.`,
    };
  }

  const cached = await listingPois.getByListingId(listingId);

  let dataSource: 'cache' | 'live' | null = null;
  let poiData: Array<{
    name: string;
    category: string;
    distanceM: number;
    coordinate?: { latitude: number; longitude: number };
  }> = [];

  if (listing.latitude != null && listing.longitude != null) {
    const nearby = await pois.findNearby(listing.latitude, listing.longitude, 2000);
    poiData = nearby.map((poi) => ({
      name: poi.name,
      category: poi.category,
      distanceM: poi.distanceM,
      coordinate: {
        latitude: poi.latitude,
        longitude: poi.longitude,
      },
    }));
    dataSource = 'live';

    try {
      await listingPois.cacheNearestPois(listingId, nearby);
    } catch {
      // Best-effort cache refresh only.
    }
  } else if (cached.length > 0) {
    poiData = cached.map((row) => ({
      name: row.poiName,
      category: row.category,
      distanceM: row.distanceM,
    }));
    dataSource = 'cache';
  } else {
    const block: ContentBlock = {
      type: 'proximity_summary',
      listingId,
      listingTitle: listing.title,
      status: 'missing_coordinates',
      dataSource: null,
      summary:
        'This listing has no geocoded coordinates yet, so Copilot cannot render distance evidence.',
      listingCoordinate: null,
      nearest: [],
      counts: [],
    };
    return {
      contentBlock: block,
      rawForClaude: `Listing ${listingId} has no geocoded coordinates and no cached proximity data.`,
    };
  }

  const byCategory = new Map<
    string,
    Array<{
      name: string;
      distanceM: number;
      coordinate?: { latitude: number; longitude: number };
    }>
  >();
  for (const poi of poiData.sort((lhs, rhs) => lhs.distanceM - rhs.distanceM)) {
    const items = byCategory.get(poi.category) ?? [];
    items.push({
      name: poi.name,
      distanceM: poi.distanceM,
      coordinate: poi.coordinate,
    });
    byCategory.set(poi.category, items);
  }

  if (poiData.length === 0) {
    const block: ContentBlock = {
      type: 'proximity_summary',
      listingId,
      listingTitle: listing.title,
      status: 'no_pois',
      dataSource,
      summary: 'No nearby amenities were found in the current proximity window.',
      listingCoordinate:
        listing.latitude != null && listing.longitude != null
          ? { latitude: listing.latitude, longitude: listing.longitude }
          : null,
      nearest: [],
      counts: [],
    };
    return {
      contentBlock: block,
      rawForClaude: `No nearby points of interest found for listing ${listingId}.`,
    };
  }

  const nearest = (Object.entries(POI_CATEGORY_LABELS) as Array<[PoiCategoryCode, string]>).flatMap(
    ([category, label]) => {
      const items = byCategory.get(category) ?? [];
      const maxItems = category === 'ubahn' || category === 'tram' || category === 'bus' ? 2 : 1;
      return items.slice(0, maxItems).map((item, index) => ({
        category,
        label,
        name: item.name,
        distanceM: Math.round(item.distanceM),
        walkMinutes: Math.max(1, Math.round(item.distanceM / 80)),
        rank: index + 1,
        coordinate: item.coordinate ?? null,
      }));
    },
  );

  const counts = PROXIMITY_COUNT_SPECS.map((spec) => ({
    category: spec.category,
    label: spec.label,
    withinMeters: spec.withinMeters,
    count: poiData.filter(
      (poi) => poi.category === spec.category && poi.distanceM <= spec.withinMeters,
    ).length,
  })).filter((item) => item.count > 0);

  const summaryParts: string[] = [];
  const nearestUbahn = nearest.find((item) => item.category === 'ubahn');
  const nearestSchool = nearest.find((item) => item.category === 'school');
  const nearestMarket = nearest.find((item) => item.category === 'supermarket');
  if (nearestUbahn) summaryParts.push(`${nearestUbahn.walkMinutes} min to U-Bahn`);
  if (nearestSchool) summaryParts.push(`${nearestSchool.walkMinutes} min to school`);
  if (nearestMarket) summaryParts.push(`${nearestMarket.walkMinutes} min to supermarket`);
  if (counts.length > 0) {
    summaryParts.push(
      counts
        .slice(0, 2)
        .map((item) => `${item.count} ${item.label.toLowerCase()}`)
        .join(', '),
    );
  }

  const block: ContentBlock = {
    type: 'proximity_summary',
    listingId,
    listingTitle: listing.title,
    status: 'ok',
    dataSource,
    summary: summaryParts.join(' • ') || 'Nearby amenity evidence available.',
    listingCoordinate:
      listing.latitude != null && listing.longitude != null
        ? { latitude: listing.latitude, longitude: listing.longitude }
        : null,
    nearest,
    counts,
  };

  const rawForClaude = [
    `Points of interest near listing #${listingId} "${listing.title}":`,
    ...nearest.map(
      (item) =>
        `  ${item.label}${item.rank > 1 ? ` #${item.rank}` : ''}: ${item.name} (${item.distanceM}m)`,
    ),
    ...counts.map((item) => `  ${item.label}: ${item.count}`),
  ].join('\n');

  return { contentBlock: block, rawForClaude };
}

async function executeGetCrossSourceCluster(input: unknown): Promise<ToolResult> {
  const parsed = requireListingId(input);
  if ('rawForClaude' in parsed) return parsed;
  const { listingId } = parsed;

  const cluster = await clusters.findClusterByListingId(listingId);

  if (!cluster || cluster.members.length < 2) {
    return {
      contentBlock: {
        type: 'text',
        text: `No cross-source duplicates found for listing ${listingId}.`,
      },
      rawForClaude: `No cross-source duplicates found for listing ${listingId}.`,
    };
  }

  const sortedMembers = [...cluster.members].sort((lhs, rhs) => {
    const lhsPrice = lhs.listPriceEurCents ?? Number.MAX_SAFE_INTEGER;
    const rhsPrice = rhs.listPriceEurCents ?? Number.MAX_SAFE_INTEGER;
    return lhsPrice - rhsPrice;
  });
  const cheapest = sortedMembers[0];
  const summary =
    cluster.priceSpreadPct != null
      ? `${cluster.members.length} portals tracked. Price spread is ${cluster.priceSpreadPct.toFixed(1)}%.`
      : `${cluster.members.length} portals tracked for this property.`;

  const block: ContentBlock = {
    type: 'cross_source_comparison',
    subjectListingId: listingId,
    clusterId: cluster.id,
    priceSpreadPct: cluster.priceSpreadPct,
    summary:
      cheapest?.listPriceEurCents != null
        ? `${summary} Lowest ask: ${cheapest.sourceCode} at ${formatEur(centsToEur(cheapest.listPriceEurCents))}.`
        : summary,
    members: cluster.members.map((member) => ({
      listingId: member.listingId,
      sourceCode: member.sourceCode,
      sourceName: member.sourceName,
      title: member.title,
      listPriceEur: centsToEur(member.listPriceEurCents),
      pricePerSqmEur: member.pricePerSqmEur,
      currentScore: member.currentScore,
      canonicalUrl: member.canonicalUrl,
      firstSeenAt: member.firstSeenAt.toISOString().slice(0, 10),
      isSubject: member.listingId === listingId,
    })),
  };

  const rawLines = cluster.members.map(
    (member) =>
      `  ${member.sourceCode}: "${member.title.slice(0, 40)}" | ${formatEur(centsToEur(member.listPriceEurCents))} | Score: ${member.currentScore ?? 'N/A'}`,
  );
  const rawForClaude = [
    `Cross-source cluster for listing #${listingId} (${cluster.members.length} sources):`,
    `Price spread: ${cluster.priceSpreadPct != null ? cluster.priceSpreadPct.toFixed(1) + '%' : 'N/A'}`,
    ...rawLines,
  ].join('\n');

  return { contentBlock: block, rawForClaude };
}

// ── Public dispatch ─────────────────────────────────────────────────────────

const TOOL_MAP: Record<string, (input: unknown) => Promise<ToolResult>> = {
  search_listings: executeSearchListings,
  get_listing_detail: executeGetListingDetail,
  get_score_explanation: executeGetScoreExplanation,
  compare_listings: executeCompareListings,
  get_price_history: executeGetPriceHistory,
  get_market_stats: executeGetMarketStats,
  get_nearby_pois: executeGetNearbyPois,
  get_cross_source_cluster: executeGetCrossSourceCluster,
};

export async function executeTool(toolName: string, toolInput: unknown): Promise<ToolResult> {
  const executor = TOOL_MAP[toolName];
  if (!executor) {
    return {
      contentBlock: { type: 'text', text: `Unknown tool: ${toolName}` },
      rawForClaude: `Unknown tool: ${toolName}`,
    };
  }
  return executor(toolInput);
}
