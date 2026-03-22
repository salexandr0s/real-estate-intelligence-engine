/**
 * Future hook interfaces — placeholder contracts for planned features.
 * These are NOT implemented yet. They define the expected shapes
 * so that future implementation can be type-checked.
 */

/** Geocoding queue job data */
export interface GeocodingJobData {
  listingId: number;
  address: string;
  postalCode: string | null;
  city: string;
}

/** Cross-source duplicate clustering input */
export interface DuplicateClusterInput {
  crossSourceFingerprint: string;
  sourceId: number;
  listingId: number;
}

/** Investor feedback for scoring calibration */
export interface InvestorFeedback {
  listingId: number;
  userId: number;
  rating: 'interested' | 'not_interested' | 'bookmarked' | 'contacted';
  notes?: string;
  timestamp: string;
}

/** ML feature export row */
export interface MLFeatureRow {
  listingId: number;
  features: Record<string, number | string | null>;
  label?: string;
  exportedAt: string;
}

/** CSV/XLSX export request */
export interface ExportRequest {
  format: 'csv' | 'xlsx';
  filterCriteria?: Record<string, unknown>;
  columns?: string[];
  maxRows?: number;
}

/** Webhook registration */
export interface WebhookRegistration {
  id: number;
  userId: number;
  url: string;
  events: string[];
  secret?: string;
  isActive: boolean;
}

/** District trend data point */
export interface DistrictTrendPoint {
  districtNo: number;
  date: string;
  medianPricePerSqm: number;
  listingCount: number;
  avgDaysOnMarket: number;
}
