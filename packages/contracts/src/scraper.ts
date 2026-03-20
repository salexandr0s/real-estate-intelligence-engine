import type { ExtractionStatus, ScrapeRunScope, ScrapeRunStatus, ScrapeRunTriggerType } from './domain.js';

// ── Source Adapter Contract ─────────────────────────────────────────────────

export interface RequestPlan {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  waitForSelector?: string;
  waitForTimeout?: number;
  metadata?: Record<string, unknown>;
}

export interface CrawlProfile {
  name: string;
  sourceCode: string;
  operationType?: string;
  propertyType?: string;
  regions?: string[];
  districts?: number[];
  maxPages?: number;
  sortOrder?: string;
}

export interface DiscoveryContext {
  page: unknown; // Playwright Page — typed loosely here to avoid Playwright dependency in contracts
  requestPlan: RequestPlan;
  profile: CrawlProfile;
  scrapeRunId: number;
}

export interface DetailContext {
  page: unknown;
  requestPlan: RequestPlan;
  scrapeRunId: number;
  sourceCode: string;
}

export interface DiscoveryItem<T> {
  detailUrl: string;
  canonicalUrl?: string | null;
  externalId?: string | null;
  summaryPayload: T;
  discoveredAt: string;
  sourceCode: string;
}

export interface DiscoveryPageResult<T> {
  items: DiscoveryItem<T>[];
  nextPagePlan: RequestPlan | null;
  totalEstimate?: number | null;
  pageNumber: number;
}

export interface DetailCapture<T> {
  sourceCode: string;
  sourceListingKeyCandidate?: string;
  externalId?: string | null;
  canonicalUrl: string;
  detailUrl: string;
  discoveryUrl?: string | null;
  responseStatus?: number | null;
  responseHeaders?: Record<string, string>;
  extractedAt: string;
  payload: T;
  htmlStorageKey?: string | null;
  screenshotStorageKey?: string | null;
  harStorageKey?: string | null;
  parserVersion: number;
  extractionStatus: ExtractionStatus;
}

export type SourceAvailability =
  | { status: 'available' }
  | { status: 'removed' }
  | { status: 'sold' }
  | { status: 'rented' }
  | { status: 'reserved' }
  | { status: 'blocked' }
  | { status: 'not_found' }
  | { status: 'unknown' };

export interface SourceAdapter<TDiscoveryDTO = unknown, TDetailDTO = unknown> {
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly parserVersion: number;

  buildDiscoveryRequests(profile: CrawlProfile): Promise<RequestPlan[]>;
  extractDiscoveryPage(ctx: DiscoveryContext): Promise<DiscoveryPageResult<TDiscoveryDTO>>;
  buildDetailRequest(item: DiscoveryItem<TDiscoveryDTO>): Promise<RequestPlan | null>;
  extractDetailPage(ctx: DetailContext): Promise<DetailCapture<TDetailDTO>>;
  deriveSourceListingKey(detail: DetailCapture<TDetailDTO>): string;
  canonicalizeUrl(url: string): string;
  detectAvailability(ctx: DetailContext): SourceAvailability;
}

// ── Scrape Run ──────────────────────────────────────────────────────────────

export interface ScrapeRunCreate {
  sourceId: number;
  triggerType: ScrapeRunTriggerType;
  scope: ScrapeRunScope;
  seedName?: string;
  seedUrl?: string;
  workerHost?: string;
  workerVersion?: string;
  browserType?: string;
  browserVersion?: string;
}

export interface ScrapeRunMetrics {
  pagesFetched: number;
  listingsDiscovered: number;
  rawSnapshotsCreated: number;
  normalizedCreated: number;
  normalizedUpdated: number;
  http2xx: number;
  http4xx: number;
  http5xx: number;
  captchaCount: number;
  retryCount: number;
}

export interface ScrapeRunRow {
  id: number;
  runUuid: string;
  sourceId: number;
  triggerType: ScrapeRunTriggerType;
  scope: ScrapeRunScope;
  status: ScrapeRunStatus;
  seedName: string | null;
  seedUrl: string | null;
  scheduledAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  workerHost: string | null;
  workerVersion: string | null;
  browserType: string | null;
  browserVersion: string | null;
  pagesFetched: number;
  listingsDiscovered: number;
  rawSnapshotsCreated: number;
  normalizedCreated: number;
  normalizedUpdated: number;
  http2xx: number;
  http4xx: number;
  http5xx: number;
  captchaCount: number;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Raw Listing ─────────────────────────────────────────────────────────────

export interface RawListingUpsert {
  sourceId: number;
  sourceListingKey: string;
  externalId?: string | null;
  canonicalUrl: string;
  detailUrl: string;
  discoveryUrl?: string | null;
  payloadFormat: 'json' | 'html' | 'mixed';
  extractionStatus: ExtractionStatus;
  responseStatus?: number | null;
  responseHeaders?: Record<string, string>;
  rawPayload: Record<string, unknown>;
  bodyStorageKey?: string | null;
  screenshotStorageKey?: string | null;
  harStorageKey?: string | null;
  contentSha256: string;
  parserVersion: number;
  scrapeRunId: number;
}

export interface RawListingRow {
  id: number;
  sourceId: number;
  sourceListingKey: string;
  externalId: string | null;
  canonicalUrl: string;
  detailUrl: string;
  discoveryUrl: string | null;
  payloadFormat: string;
  extractionStatus: ExtractionStatus;
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  rawPayload: Record<string, unknown>;
  bodyStorageKey: string | null;
  screenshotStorageKey: string | null;
  harStorageKey: string | null;
  contentSha256: string;
  parserVersion: number;
  firstScrapeRunId: number;
  lastScrapeRunId: number;
  observedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  observationCount: number;
  isDeletedAtSource: boolean;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Retry / Error Classification ────────────────────────────────────────────

export type ErrorClass = 'transient_network' | 'soft_anti_bot' | 'parse_failure' | 'terminal_page' | 'unknown';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
  discovery: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000, jitterFactor: 0.3 },
  detail: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000, jitterFactor: 0.3 },
  normalization: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000, jitterFactor: 0.2 },
  scoring: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000, jitterFactor: 0.2 },
  alert_delivery: { maxAttempts: 5, baseDelayMs: 5000, maxDelayMs: 60000, jitterFactor: 0.4 },
};
