import { query } from '../client.js';

export interface CanaryResultInsert {
  sourceCode: string;
  success: boolean;
  discoveryOk: boolean;
  detailOk: boolean;
  ingestionOk: boolean;
  scoringOk: boolean;
  listingsFound: number;
  durationMs: number;
  errorMessage: string | null;
}

interface CanaryResultDbRow {
  id: string;
  source_code: string;
  success: boolean;
  discovery_ok: boolean;
  detail_ok: boolean;
  ingestion_ok: boolean;
  scoring_ok: boolean;
  listings_found: number;
  duration_ms: number;
  error_message: string | null;
  created_at: Date;
}

export interface CanaryResultRow {
  id: number;
  sourceCode: string;
  success: boolean;
  discoveryOk: boolean;
  detailOk: boolean;
  ingestionOk: boolean;
  scoringOk: boolean;
  listingsFound: number;
  durationMs: number;
  errorMessage: string | null;
  createdAt: Date;
}

function mapRow(row: CanaryResultDbRow): CanaryResultRow {
  return {
    id: Number(row.id),
    sourceCode: row.source_code,
    success: row.success,
    discoveryOk: row.discovery_ok,
    detailOk: row.detail_ok,
    ingestionOk: row.ingestion_ok,
    scoringOk: row.scoring_ok,
    listingsFound: row.listings_found,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

/** Insert a canary check result. */
export async function insert(input: CanaryResultInsert): Promise<CanaryResultRow> {
  const rows = await query<CanaryResultDbRow>(
    `INSERT INTO canary_results (
       source_code, success, discovery_ok, detail_ok, ingestion_ok,
       scoring_ok, listings_found, duration_ms, error_message
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.sourceCode,
      input.success,
      input.discoveryOk,
      input.detailOk,
      input.ingestionOk,
      input.scoringOk,
      input.listingsFound,
      input.durationMs,
      input.errorMessage,
    ],
  );
  return mapRow(rows[0]!);
}

/** Count consecutive failures for a source (most recent first). */
export async function countConsecutiveFailures(sourceCode: string): Promise<number> {
  const rows = await query<CanaryResultDbRow>(
    `SELECT * FROM canary_results
     WHERE source_code = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [sourceCode],
  );
  let count = 0;
  for (const row of rows) {
    if (row.success) break;
    count++;
  }
  return count;
}

/** Find the most recent canary result per source. */
export async function findLatestPerSource(): Promise<CanaryResultRow[]> {
  const rows = await query<CanaryResultDbRow>(
    `SELECT DISTINCT ON (source_code) *
     FROM canary_results
     ORDER BY source_code, created_at DESC`,
  );
  return rows.map(mapRow);
}
