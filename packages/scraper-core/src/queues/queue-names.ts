/**
 * Shared BullMQ queue names and job data types.
 */

export const QUEUE_NAMES = {
  SCRAPE_DISCOVERY: 'scrape-discovery',
  SCRAPE_DETAIL: 'scrape-detail',
  PROCESSING: 'processing-ingest',
  BASELINE: 'processing-baseline',
  GEOCODING: 'processing-geocoding',
  RESCORE: 'processing-rescore',
  CLUSTER: 'processing-cluster',
  GEOCODE_ENQUEUE: 'processing-geocode-enqueue',
  STALE_CHECK: 'processing-stale-check',
  CANARY: 'processing-canary',
  ALERT_DELIVERY: 'processing-alert-delivery',
  DOCUMENT_PROCESSING: 'document-processing',
} as const;

/** Job data for a discovery scrape (one source, one page). */
export interface DiscoveryJobData {
  sourceCode: string;
  sourceId: number;
  scrapeRunId: number;
  page: number;
  maxPages: number;
}

/** Job data for a detail page scrape. */
export interface DetailJobData {
  sourceCode: string;
  sourceId: number;
  scrapeRunId: number;
  detailUrl: string;
  discoveryUrl: string;
  title: string;
  externalId?: string;
}

/** Job data for processing a raw detail capture. */
export interface ProcessingJobData {
  sourceCode: string;
  sourceId: number;
  scrapeRunId: number;
  detailUrl: string;
  discoveryUrl: string;
  /** Serialized DetailCapture JSON. */
  captureJson: string;
  /** Storage key for the captured HTML artifact, if saved. */
  htmlStorageKey?: string;
  /** Storage key for the failure screenshot artifact, if saved. */
  screenshotStorageKey?: string;
  /** Storage key for the captured HAR artifact, if saved. */
  harStorageKey?: string;
}

/** Job data for baseline recomputation. */
export interface BaselineJobData {
  triggeredBy: 'scheduler' | 'manual';
}

/** Job data for geocoding a listing. */
export interface GeocodingJobData {
  listingId: number;
  address: string | null;
  postalCode: string | null;
  city: string;
  districtNo: number | null;
  /** Listing title for NLP-based location extraction */
  title: string | null;
  /** Listing description for NLP-based location extraction */
  description: string | null;
  /** Address display string for NLP-based location extraction */
  addressDisplay: string | null;
}

/** Job data for batch rescore operation. */
export interface RescoreJobData {
  triggeredBy: 'api' | 'manual';
  sourceCode: string | null;
  limit: number;
}

/** Job data for cluster rebuild operation. */
export interface ClusterJobData {
  triggeredBy: 'scheduler' | 'manual';
}

/** Job data for geocoding enqueue operation. */
export interface GeocodeEnqueueJobData {
  triggeredBy: 'scheduler' | 'manual';
  limit: number;
}

/** Job data for stale listing detection. */
export interface StaleCheckJobData {
  triggeredBy: 'scheduler' | 'manual';
  thresholdDays?: number;
  batchSize?: number;
}

/** Job data for canary health check. */
export interface CanaryJobData {
  triggeredBy: 'scheduler' | 'manual';
  sourceCode?: string;
}

/** Job data for alert delivery (push, email, webhook). */
export interface AlertDeliveryJobData {
  alertId: number;
  channel: string;
  userId: number;
}

/** Job data for document processing (download, extract, parse). */
export interface DocumentProcessingJobData {
  documentId: number;
}

/** Default retry config for scraper jobs. */
export const DEFAULT_JOB_RETRY_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
};
