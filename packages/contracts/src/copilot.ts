// ── Copilot Content Block Types ──────────────────────────────────────────────
// Shared between the backend (SSE stream) and the Swift client (decoding).
// Each block has a `type` discriminant so the client can dispatch to the
// correct renderer.

// ── Atomic block payloads ───────────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ListingCardDTO {
  id: number;
  title: string;
  districtNo: number | null;
  districtName: string | null;
  priceEur: number | null;
  areaSqm: number | null;
  rooms: number | null;
  pricePerSqmEur: number | null;
  score: number | null;
  canonicalUrl: string;
  sourceCode: string | null;
  priceTrendPct: number | null;
}

export interface ListingCardsBlock {
  type: 'listing_cards';
  listings: ListingCardDTO[];
}

export interface ComparisonRow {
  label: string;
  values: (string | number | null)[];
}

export interface ComparisonTableBlock {
  type: 'comparison_table';
  headers: string[];
  rows: ComparisonRow[];
}

export interface ScoreComponent {
  name: string;
  score: number;
  weight: number;
  label: string;
}

export interface ScoreBreakdownBlock {
  type: 'score_breakdown';
  listingId: number;
  listingTitle: string;
  overallScore: number;
  components: ScoreComponent[];
  discountToDistrictPct: number | null;
  discountToBucketPct: number | null;
  positiveKeywords: string[];
  negativeKeywords: string[];
}

export interface PricePoint {
  date: string;
  priceEur: number;
  reason: string;
}

export interface PriceHistoryBlock {
  type: 'price_history';
  listingId: number;
  listingTitle: string;
  dataPoints: PricePoint[];
}

export interface ChartSeries {
  name: string;
  dataPoints: { x: string; y: number }[];
}

export interface ChartDataBlock {
  type: 'chart_data';
  chartType: 'line' | 'bar';
  title: string;
  xLabel: string;
  yLabel: string;
  series: ChartSeries[];
}

export interface StatItem {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
}

export interface MarketStatsBlock {
  type: 'market_stats';
  stats: StatItem[];
}

export type ComparisonCalloutTone = 'positive' | 'neutral' | 'caution';

export interface ComparisonCallout {
  label: string;
  detail: string;
  listingId: number | null;
  tone: ComparisonCalloutTone;
}

export interface ListingComparisonValue {
  listingId: number;
  value: string | null;
  emphasis?: 'best' | 'weakest' | 'neutral';
}

export interface ListingComparisonMetric {
  label: string;
  values: ListingComparisonValue[];
}

export interface ListingComparisonSection {
  title: string;
  metrics: ListingComparisonMetric[];
}

export interface ListingComparisonBlock {
  type: 'listing_comparison';
  listings: ListingCardDTO[];
  sections: ListingComparisonSection[];
  callouts: ComparisonCallout[];
}

export type ProximityDataSource = 'cache' | 'live';
export type ProximityStatus = 'ok' | 'missing_coordinates' | 'no_pois';
export type PoiCategoryCode =
  | 'ubahn'
  | 'tram'
  | 'bus'
  | 'taxi'
  | 'park'
  | 'school'
  | 'police'
  | 'fire_station'
  | 'supermarket'
  | 'hospital'
  | 'doctor';

export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

export interface ProximityNearestItem {
  category: PoiCategoryCode;
  label: string;
  name: string;
  distanceM: number;
  walkMinutes: number;
  rank: number;
  coordinate?: GeoCoordinate | null;
}

export interface ProximityCountItem {
  category: PoiCategoryCode;
  label: string;
  withinMeters: number;
  count: number;
}

export interface ProximitySummaryBlock {
  type: 'proximity_summary';
  listingId: number;
  listingTitle: string;
  status: ProximityStatus;
  dataSource: ProximityDataSource | null;
  summary: string;
  listingCoordinate?: GeoCoordinate | null;
  nearest: ProximityNearestItem[];
  counts: ProximityCountItem[];
}

export interface CrossSourceComparisonMember {
  listingId: number;
  sourceCode: string;
  sourceName: string;
  title: string;
  listPriceEur: number | null;
  pricePerSqmEur: number | null;
  currentScore: number | null;
  canonicalUrl: string;
  firstSeenAt: string;
  isSubject: boolean;
}

export interface CrossSourceComparisonBlock {
  type: 'cross_source_comparison';
  subjectListingId: number;
  clusterId: number;
  priceSpreadPct: number | null;
  summary: string;
  members: CrossSourceComparisonMember[];
}

// ── Discriminated union ─────────────────────────────────────────────────────

export type ContentBlock =
  | TextBlock
  | ListingCardsBlock
  | ComparisonTableBlock
  | ScoreBreakdownBlock
  | PriceHistoryBlock
  | ChartDataBlock
  | MarketStatsBlock
  | ListingComparisonBlock
  | ProximitySummaryBlock
  | CrossSourceComparisonBlock;

// ── Request / Response types ────────────────────────────────────────────────

export interface CopilotRequestMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface CopilotChatRequest {
  messages: CopilotRequestMessage[];
  context?: {
    currentListingId?: number;
    currentDistrictNo?: number;
  };
}
