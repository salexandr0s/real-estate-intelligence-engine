import type { AlertFrequency, FilterKind, OperationType, PropertyType, SortBy } from './domain.js';

// ── Filter DTO ──────────────────────────────────────────────────────────────

export interface FilterCriteria {
  operationType?: OperationType | null;
  propertyTypes?: PropertyType[];
  districts?: number[];
  postalCodes?: string[];
  minPriceEur?: number | null;
  maxPriceEur?: number | null;
  minAreaSqm?: number | null;
  maxAreaSqm?: number | null;
  minRooms?: number | null;
  maxRooms?: number | null;
  minScore?: number | null;
  requiredKeywords?: string[];
  excludedKeywords?: string[];
  sortBy?: SortBy;
}

export interface FilterCreateInput {
  userId: number;
  name: string;
  filterKind: FilterKind;
  criteria: FilterCriteria;
  alertFrequency: AlertFrequency;
  alertChannels: string[];
}

export interface FilterUpdateInput {
  name?: string;
  isActive?: boolean;
  criteria?: Partial<FilterCriteria>;
  alertFrequency?: AlertFrequency;
  alertChannels?: string[];
}

// ── Compiled Filter ─────────────────────────────────────────────────────────

export interface CompiledFilter {
  operationType?: OperationType;
  propertyTypes?: PropertyType[];
  districts?: number[];
  postalCodes?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  minAreaSqm?: number;
  maxAreaSqm?: number;
  minRooms?: number;
  maxRooms?: number;
  minScore?: number;
  requiredKeywords?: string[];
  excludedKeywords?: string[];
  sortBy: SortBy;
}

// ── User Filter Row ─────────────────────────────────────────────────────────

export interface UserFilterRow {
  id: number;
  userId: number;
  name: string;
  filterKind: FilterKind;
  isActive: boolean;
  operationType: OperationType | null;
  propertyTypes: string[];
  districts: number[];
  postalCodes: string[];
  minPriceEurCents: number | null;
  maxPriceEurCents: number | null;
  minAreaSqm: number | null;
  maxAreaSqm: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  requiredKeywords: string[];
  excludedKeywords: string[];
  minScore: number | null;
  sortBy: SortBy;
  alertFrequency: AlertFrequency;
  alertChannels: string[];
  criteriaJson: Record<string, unknown>;
  lastEvaluatedAt: Date | null;
  lastMatchAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Query Result ────────────────────────────────────────────────────────────

export interface ListingSearchResult {
  id: number;
  listingUid: string;
  sourceCode?: string;
  canonicalUrl: string;
  title: string;
  operationType: string;
  propertyType: string;
  city: string;
  postalCode: string | null;
  districtNo: number | null;
  districtName: string | null;
  listPriceEurCents: number | null;
  livingAreaSqm: number | null;
  rooms: number | null;
  pricePerSqmEur: number | null;
  currentScore: number | null;
  firstSeenAt: Date;
  listingStatus: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    nextCursor: string | null;
    pageSize: number;
  };
}
