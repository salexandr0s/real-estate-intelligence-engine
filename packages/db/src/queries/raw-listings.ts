import { query } from '../client.js';
import type { RawListingUpsert, RawListingRow, ExtractionStatus } from '@immoradar/contracts';

// ── Row mapping ─────────────────────────────────────────────────────────────

interface RawListingDbRow {
  id: string;
  source_id: string;
  source_listing_key: string;
  external_id: string | null;
  canonical_url: string;
  detail_url: string;
  discovery_url: string | null;
  payload_format: string;
  extraction_status: ExtractionStatus;
  response_status: number | null;
  response_headers: Record<string, string>;
  raw_payload: Record<string, unknown>;
  body_storage_key: string | null;
  screenshot_storage_key: string | null;
  har_storage_key: string | null;
  content_sha256: string;
  parser_version: number;
  first_scrape_run_id: string;
  last_scrape_run_id: string;
  observed_at: Date;
  first_seen_at: Date;
  last_seen_at: Date;
  observation_count: number;
  is_deleted_at_source: boolean;
  meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function toRawListingRow(row: RawListingDbRow): RawListingRow {
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    sourceListingKey: row.source_listing_key,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    detailUrl: row.detail_url,
    discoveryUrl: row.discovery_url,
    payloadFormat: row.payload_format,
    extractionStatus: row.extraction_status,
    responseStatus: row.response_status,
    responseHeaders: row.response_headers,
    rawPayload: row.raw_payload,
    bodyStorageKey: row.body_storage_key,
    screenshotStorageKey: row.screenshot_storage_key,
    harStorageKey: row.har_storage_key,
    contentSha256: row.content_sha256,
    parserVersion: row.parser_version,
    firstScrapeRunId: Number(row.first_scrape_run_id),
    lastScrapeRunId: Number(row.last_scrape_run_id),
    observedAt: row.observed_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    observationCount: row.observation_count,
    isDeletedAtSource: row.is_deleted_at_source,
    meta: row.meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Idempotent upsert of a raw listing snapshot.
 * Unique key: (source_id, source_listing_key, content_sha256).
 *
 * - If the combination exists: update last_seen_at, last_scrape_run_id,
 *   and increment observation_count.
 * - If it does not exist: insert a new row.
 */
export async function upsertRawSnapshot(input: RawListingUpsert): Promise<RawListingRow> {
  const rows = await query<RawListingDbRow>(
    `INSERT INTO raw_listings (
       source_id, source_listing_key, external_id, canonical_url,
       detail_url, discovery_url, payload_format, extraction_status,
       response_status, response_headers, raw_payload,
       body_storage_key, screenshot_storage_key, har_storage_key,
       content_sha256, parser_version,
       first_scrape_run_id, last_scrape_run_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $17
     )
     ON CONFLICT (source_id, source_listing_key, content_sha256)
     DO UPDATE SET
       last_seen_at = NOW(),
       last_scrape_run_id = $17,
       observation_count = raw_listings.observation_count + 1
     RETURNING *`,
    [
      input.sourceId,
      input.sourceListingKey,
      input.externalId ?? null,
      input.canonicalUrl,
      input.detailUrl,
      input.discoveryUrl ?? null,
      input.payloadFormat,
      input.extractionStatus,
      input.responseStatus ?? null,
      JSON.stringify(input.responseHeaders ?? {}),
      JSON.stringify(input.rawPayload),
      input.bodyStorageKey ?? null,
      input.screenshotStorageKey ?? null,
      input.harStorageKey ?? null,
      input.contentSha256,
      input.parserVersion,
      input.scrapeRunId,
    ],
  );
  return toRawListingRow(rows[0]!);
}

/**
 * Find all raw listing snapshots for a given source and listing key,
 * ordered by last_seen_at descending.
 */
export async function findBySourceKey(
  sourceId: number,
  sourceListingKey: string,
): Promise<RawListingRow[]> {
  const rows = await query<RawListingDbRow>(
    `SELECT * FROM raw_listings
     WHERE source_id = $1 AND source_listing_key = $2
     ORDER BY last_seen_at DESC`,
    [sourceId, sourceListingKey],
  );
  return rows.map(toRawListingRow);
}

/**
 * Find the most recent raw listing snapshot for a given source and listing key.
 */
export async function findLatestBySourceKey(
  sourceId: number,
  sourceListingKey: string,
): Promise<RawListingRow | null> {
  const rows = await query<RawListingDbRow>(
    `SELECT * FROM raw_listings
     WHERE source_id = $1 AND source_listing_key = $2
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [sourceId, sourceListingKey],
  );
  const row = rows[0];
  return row ? toRawListingRow(row) : null;
}
