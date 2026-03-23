// ── Comparable Listing ─────────────────────────────────────────────────────

export interface ComparableEntry {
  listingId: number;
  title: string;
  districtNo: number | null;
  operationType: string;
  propertyType: string;
  listPriceEurCents: number | null;
  pricePerSqmEur: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  distanceM: number | null;
  firstSeenAt: Date;
  canonicalUrl: string;
  /** Why this comparable was selected (e.g., "nearby similar apartment") */
  matchReason?: string;
  /** Days since the comparable was first seen */
  recencyDays?: number;
  /** How close the area is to the target listing (percentage, 100 = identical) */
  areaSimilarityPct?: number | null;
  /** Difference in room count vs target listing */
  roomDiff?: number | null;
}

export type ComparableFallbackLevel = 'nearby' | 'district' | 'city';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface MarketContext {
  comparables: ComparableEntry[];
  fallbackLevel: ComparableFallbackLevel;
  sampleSize: number;
  medianPpsqm: number | null;
  p25Ppsqm: number | null;
  p75Ppsqm: number | null;
  confidence: ConfidenceLevel;
}

// ── Market Rent Estimate ──────────────────────────────────────────────────

export interface MarketRentEstimate {
  estimateLow: number | null;
  estimateMid: number | null;
  estimateHigh: number | null;
  eurPerSqmMid: number | null;
  fallbackLevel: ComparableFallbackLevel;
  sampleSize: number;
  confidence: ConfidenceLevel;
}

// ── Investor Metrics ──────────────────────────────────────────────────────

export interface InvestorMetrics {
  grossYield: {
    value: number | null;
    assumptions: string[];
  };
  priceToRent: number | null;
  sensitivityBands: {
    low: number | null;
    base: number | null;
    high: number | null;
  };
}

// ── Building Context ──────────────────────────────────────────────────────

export interface BuildingContext {
  buildingFactId: number;
  matchConfidence: string;
  yearBuilt: number | null;
  typology: string | null;
  unitCount: number | null;
  source: string;
  sourceUpdatedAt: Date | null;
}

// ── Legal-Rent Summary ──────────────────────────────────────────────────

export interface LegalRentSummary {
  status: string;
  regimeCandidate: string | null;
  confidence: string;
  strongSignals: Array<{ signal: string; source: string }>;
  weakSignals: Array<{ signal: string; source: string }>;
  missingFacts: string[];
  reviewRequired: boolean;
  indicativeBandLow: number | null;
  indicativeBandHigh: number | null;
  disclaimer: string;
}

// ── Analysis Confidence ──────────────────────────────────────────────────

export interface AnalysisConfidence {
  level: ConfidenceLevel;
  degradationReasons: string[];
}

// ── Listing Analysis ──────────────────────────────────────────────────────

export interface ListingAnalysis {
  listingId: number;
  summary: {
    headline: string;
    keyFacts: string[];
  };
  locationContext: {
    districtNo: number | null;
    districtName: string | null;
    nearestTransit: string | null;
    nearestTransitDistanceM: number | null;
    parksNearby: number;
    schoolsNearby: number;
  };
  buildingContext: BuildingContext | null;
  marketSaleContext: MarketContext | null;
  marketRentContext: MarketRentEstimate | null;
  investorMetrics: InvestorMetrics | null;
  riskFlags: string[];
  upsideFlags: string[];
  assumptions: string[];
  missingData: string[];
  legalRentSummary: LegalRentSummary | null;
  confidence: AnalysisConfidence;
  computedAt: Date;
}
