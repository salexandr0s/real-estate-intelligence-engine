// ── Tool executor ────────────────────────────────────────────────────────────
// Routes tool calls to existing @rei/db query functions and formats results
// into ContentBlock types for the Swift client + text summaries for Claude.

import {
  listings,
  listingScores,
  listingVersions,
  clusters,
  pois,
  listingPois,
  dashboard,
} from '@rei/db';
import { VIENNA_DISTRICTS } from '@rei/contracts';
import type {
  ContentBlock,
  ListingCardDTO,
  ScoreComponent,
  OperationType,
  PropertyType,
  SortBy,
  ListingRow,
} from '@rei/contracts';
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

  const found = results.filter(
    (r): r is { listing: ListingRow; score: typeof r.score } => r.listing != null,
  );

  if (found.length < 2) {
    return {
      contentBlock: {
        type: 'text',
        text: `Could not find enough listings to compare. Found ${found.length} of ${listingIds.length} requested.`,
      },
      rawForClaude: `Could not find enough listings to compare. Only ${found.length} found.`,
    };
  }

  const headers = [
    'Metric',
    ...found.map((f) => `#${f.listing.id} ${f.listing.title.slice(0, 30)}`),
  ];

  const metricRows: { label: string; values: (string | number | null)[] }[] = [
    {
      label: 'Price (EUR)',
      values: found.map((f) => centsToEur(f.listing.listPriceEurCents)),
    },
    {
      label: 'Price/sqm',
      values: found.map((f) => f.listing.pricePerSqmEur),
    },
    {
      label: 'Area (sqm)',
      values: found.map((f) => f.listing.livingAreaSqm),
    },
    {
      label: 'Rooms',
      values: found.map((f) => f.listing.rooms),
    },
    {
      label: 'District',
      values: found.map((f) => districtLabel(f.listing.districtNo)),
    },
    {
      label: 'Score',
      values: found.map((f) => f.listing.currentScore),
    },
    {
      label: 'Undervaluation',
      values: found.map((f) => f.score?.undervaluationScore ?? null),
    },
    {
      label: 'Discount to District',
      values: found.map((f) =>
        f.score?.discountToDistrictPct != null
          ? `${f.score.discountToDistrictPct.toFixed(1)}%`
          : null,
      ),
    },
    {
      label: 'Year Built',
      values: found.map((f) => f.listing.yearBuilt),
    },
    {
      label: 'Status',
      values: found.map((f) => f.listing.listingStatus),
    },
  ];

  const block: ContentBlock = {
    type: 'comparison_table',
    headers,
    rows: metricRows.map((mr) => ({
      label: mr.label,
      values: mr.values.map((v) => (v != null ? String(v) : null)),
    })),
  };

  const rawLines = metricRows.map((mr) => {
    const vals = mr.values.map((v) => (v != null ? String(v) : 'N/A')).join(' | ');
    return `${mr.label}: ${vals}`;
  });
  const rawForClaude = `Comparison of ${found.length} listings:\n${rawLines.join('\n')}`;

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

  // Reverse so oldest first for chronological display
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

  // Use dashboard stats for citywide view; for district-filtered data, run a
  // filtered search to derive counts.
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

  // If a specific district was requested, also get count for that district
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

  // Try cached POIs first, fall back to live Haversine computation
  let poiData: { name: string; category: string; distanceM: number }[] = [];
  const cached = await listingPois.getByListingId(listingId);

  if (cached.length > 0) {
    poiData = cached.map((r) => ({
      name: r.poiName,
      category: r.category,
      distanceM: r.distanceM,
    }));
  } else if (listing.latitude != null && listing.longitude != null) {
    const nearby = await pois.findNearby(listing.latitude, listing.longitude, 2000);
    // Cache for next time (best-effort, don't break the response on failure)
    try {
      await listingPois.cacheNearestPois(listingId, nearby);
    } catch {
      // Cache write failed — non-critical, continue with live data
    }
    // Take top 2 per category to match cached format
    const byCategory = new Map<string, typeof nearby>();
    for (const poi of nearby) {
      const existing = byCategory.get(poi.category);
      if (existing) {
        if (existing.length < 2) existing.push(poi);
      } else {
        byCategory.set(poi.category, [poi]);
      }
    }
    for (const items of byCategory.values()) {
      for (const item of items) {
        poiData.push({ name: item.name, category: item.category, distanceM: item.distanceM });
      }
    }
  } else {
    return {
      contentBlock: {
        type: 'text',
        text: `Listing ${listingId} has no geocoded coordinates and no cached proximity data.`,
      },
      rawForClaude: `Listing ${listingId} has no geocoded coordinates.`,
    };
  }

  // Unified output: show up to 2 closest named POIs per category
  const categories = new Map<string, { name: string; distanceM: number }[]>();
  for (const poi of poiData) {
    const existing = categories.get(poi.category) ?? [];
    existing.push({ name: poi.name, distanceM: poi.distanceM });
    categories.set(poi.category, existing);
  }

  const transitCats = ['ubahn', 'tram', 'bus'];
  const categoryLabels: Record<string, string> = {
    ubahn: 'U-Bahn',
    tram: 'Tram',
    bus: 'Bus',
    park: 'Park',
    school: 'School',
    supermarket: 'Supermarket',
    hospital: 'Hospital',
    doctor: 'Doctor',
    police: 'Police',
    fire_station: 'Fire Station',
  };

  const stats: { label: string; value: string | number }[] = [];
  for (const [cat, label] of Object.entries(categoryLabels)) {
    const items = categories.get(cat) ?? [];
    if (items.length === 0) {
      stats.push({ label: `Nearest ${label}`, value: 'None nearby' });
      continue;
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const suffix = items.length > 1 ? ` (#${i + 1})` : '';
      stats.push({
        label: transitCats.includes(cat) ? `${label}${suffix}` : `Nearest ${label}${suffix}`,
        value: `${item.name} (${Math.round(item.distanceM)}m)`,
      });
    }
  }

  const block: ContentBlock = { type: 'market_stats', stats };
  const rawLines = stats.map((s) => `  ${s.label}: ${s.value}`);
  const rawForClaude = `Points of interest near listing #${listingId} "${listing.title}":\n${rawLines.join('\n')}`;

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

  const headers = ['Source', 'Title', 'Price (EUR)', 'Price/sqm', 'Score', 'First Seen'];
  const rows = cluster.members.map((m) => ({
    label: m.sourceCode,
    values: [
      m.title.slice(0, 50),
      centsToEur(m.listPriceEurCents),
      m.pricePerSqmEur,
      m.currentScore,
      m.firstSeenAt.toISOString().slice(0, 10),
    ] as (string | number | null)[],
  }));

  const block: ContentBlock = {
    type: 'comparison_table',
    headers,
    rows,
  };

  const rawLines = cluster.members.map(
    (m) =>
      `  ${m.sourceCode}: "${m.title.slice(0, 40)}" | ${formatEur(centsToEur(m.listPriceEurCents))} | Score: ${m.currentScore ?? 'N/A'}`,
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
