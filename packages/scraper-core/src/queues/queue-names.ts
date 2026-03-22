/**
 * Shared BullMQ queue names and job data types.
 */

export const QUEUE_NAMES = {
  SCRAPE_DISCOVERY: 'scrape-discovery',
  SCRAPE_DETAIL: 'scrape-detail',
  PROCESSING: 'processing-ingest',
  BASELINE: 'processing-baseline',
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
