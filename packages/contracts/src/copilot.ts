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

// ── Discriminated union ─────────────────────────────────────────────────────

export type ContentBlock =
  | TextBlock
  | ListingCardsBlock
  | ComparisonTableBlock
  | ScoreBreakdownBlock
  | PriceHistoryBlock
  | ChartDataBlock
  | MarketStatsBlock;

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
