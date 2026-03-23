import type { AlertChannel, AlertStatus, AlertType } from './domain.js';

// ── Match Reasons ────────────────────────────────────────────────────────────

/** Structured explanation of why a listing matched a filter. */
export interface AlertMatchReasons {
  /** Which required keywords matched in the listing text. */
  matchedKeywords?: string[];
  /** Which excluded keywords were checked and did NOT match (confirmation). */
  excludedKeywordsClean?: boolean;
  /** Whether the listing's district matched the filter's district list. */
  districtMatch?: boolean;
  /** Thresholds that the listing met. */
  thresholdsMet?: {
    price?: boolean;
    area?: boolean;
    rooms?: boolean;
    score?: boolean;
  };
  /** Filter name for context. */
  filterName?: string;
}

// ── Alert Create ────────────────────────────────────────────────────────────

export interface AlertCreate {
  userId: number;
  userFilterId: number;
  listingId: number;
  listingVersionId?: number | null;
  alertType: AlertType;
  channel: AlertChannel;
  dedupeKey: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  scheduledFor?: Date;
  matchReasons?: AlertMatchReasons | null;
  clusterFingerprint?: string | null;
}

// ── Alert Row ───────────────────────────────────────────────────────────────

export interface AlertRow {
  id: number;
  userId: number;
  userFilterId: number;
  listingId: number;
  listingVersionId: number | null;
  alertType: AlertType;
  channel: AlertChannel;
  status: AlertStatus;
  dedupeKey: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  matchReasons: AlertMatchReasons | null;
  clusterFingerprint: string | null;
  matchedAt: Date;
  scheduledFor: Date;
  sentAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Present only when query JOINs user_filters (e.g. findByUser). */
  filterName?: string | null;
}

// ── Dedupe Key Builder ──────────────────────────────────────────────────────

export function buildAlertDedupeKey(params: {
  filterId: number;
  listingId: number;
  alertType: AlertType;
  scoreVersion?: number;
}): string {
  const parts = [
    `filter:${params.filterId}`,
    `listing:${params.listingId}`,
    `type:${params.alertType}`,
  ];
  if (params.scoreVersion != null) {
    parts.push(`sv:${params.scoreVersion}`);
  }
  return parts.join(':');
}
