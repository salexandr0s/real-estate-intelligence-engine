import type { AlertChannel, AlertStatus, AlertType } from './domain.js';

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
  matchedAt: Date;
  scheduledFor: Date;
  sentAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  filterName: string | null;
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
