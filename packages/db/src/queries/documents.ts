import { query } from '../client.js';

// ── Listing Document ────────────────────────────────────────────────────────

interface DocumentDbRow {
  id: string;
  listing_id: string;
  url: string;
  checksum: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  storage_key: string | null;
  document_type: string;
  status: string;
  page_count: number | null;
  label: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentRow {
  id: number;
  listingId: number;
  url: string;
  checksum: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  documentType: string;
  status: string;
  pageCount: number | null;
  label: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toDocumentRow(row: DocumentDbRow): DocumentRow {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    url: row.url,
    checksum: row.checksum,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    storageKey: row.storage_key,
    documentType: row.document_type,
    status: row.status,
    pageCount: row.page_count,
    label: row.label,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Document Fact Span ──────────────────────────────────────────────────────

interface FactSpanDbRow {
  id: string;
  extraction_id: string;
  fact_type: string;
  fact_value: string;
  page_number: number | null;
  span_start: number | null;
  span_end: number | null;
  confidence: string;
  source_snippet: string | null;
  created_at: Date;
}

export interface FactSpanRow {
  id: number;
  extractionId: number;
  factType: string;
  factValue: string;
  pageNumber: number | null;
  spanStart: number | null;
  spanEnd: number | null;
  confidence: string;
  sourceSnippet: string | null;
  createdAt: Date;
}

function toFactSpanRow(row: FactSpanDbRow): FactSpanRow {
  return {
    id: Number(row.id),
    extractionId: Number(row.extraction_id),
    factType: row.fact_type,
    factValue: row.fact_value,
    pageNumber: row.page_number,
    spanStart: row.span_start,
    spanEnd: row.span_end,
    confidence: row.confidence,
    sourceSnippet: row.source_snippet,
    createdAt: row.created_at,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

export interface UpsertDocumentInput {
  listingId: number;
  url: string;
  checksum?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  storageKey?: string | null;
  documentType?: string;
  label?: string | null;
  pageCount?: number | null;
  status?: string;
}

export async function upsertDocument(input: UpsertDocumentInput): Promise<DocumentRow> {
  const rows = await query<DocumentDbRow>(
    `INSERT INTO listing_documents (
       listing_id, url, checksum, mime_type, size_bytes,
       storage_key, document_type, label, page_count, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (listing_id, checksum) DO UPDATE SET
       url = EXCLUDED.url,
       mime_type = COALESCE(EXCLUDED.mime_type, listing_documents.mime_type),
       size_bytes = COALESCE(EXCLUDED.size_bytes, listing_documents.size_bytes),
       storage_key = COALESCE(EXCLUDED.storage_key, listing_documents.storage_key),
       document_type = COALESCE(EXCLUDED.document_type, listing_documents.document_type),
       label = COALESCE(EXCLUDED.label, listing_documents.label),
       page_count = COALESCE(EXCLUDED.page_count, listing_documents.page_count),
       status = COALESCE(EXCLUDED.status, listing_documents.status),
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      input.listingId,
      input.url,
      input.checksum ?? null,
      input.mimeType ?? null,
      input.sizeBytes ?? null,
      input.storageKey ?? null,
      input.documentType ?? 'unknown',
      input.label ?? null,
      input.pageCount ?? null,
      input.status ?? 'pending',
    ],
  );
  return toDocumentRow(rows[0]!);
}

export async function findById(id: number): Promise<DocumentRow | null> {
  const rows = await query<DocumentDbRow>(`SELECT * FROM listing_documents WHERE id = $1`, [id]);
  return rows[0] ? toDocumentRow(rows[0]) : null;
}

export async function findByListingId(listingId: number): Promise<DocumentRow[]> {
  const rows = await query<DocumentDbRow>(
    `SELECT * FROM listing_documents
     WHERE listing_id = $1
     ORDER BY document_type, first_seen_at DESC`,
    [listingId],
  );
  return rows.map(toDocumentRow);
}

export async function updateStatus(
  id: number,
  status: string,
  updates?: {
    storageKey?: string;
    checksum?: string;
    mimeType?: string;
    sizeBytes?: number;
    pageCount?: number;
  },
): Promise<DocumentRow | null> {
  const rows = await query<DocumentDbRow>(
    `UPDATE listing_documents SET
       status = $2,
       storage_key = COALESCE($3, storage_key),
       checksum = COALESCE($4, checksum),
       mime_type = COALESCE($5, mime_type),
       size_bytes = COALESCE($6, size_bytes),
       page_count = COALESCE($7, page_count),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      updates?.storageKey ?? null,
      updates?.checksum ?? null,
      updates?.mimeType ?? null,
      updates?.sizeBytes ?? null,
      updates?.pageCount ?? null,
    ],
  );
  return rows[0] ? toDocumentRow(rows[0]) : null;
}

export async function findPendingDocuments(limit = 50): Promise<DocumentRow[]> {
  const rows = await query<DocumentDbRow>(
    `SELECT * FROM listing_documents
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map(toDocumentRow);
}

export async function findFactsByDocumentId(documentId: number): Promise<FactSpanRow[]> {
  const rows = await query<FactSpanDbRow>(
    `SELECT dfs.* FROM document_fact_spans dfs
     JOIN document_extractions de ON de.id = dfs.extraction_id
     WHERE de.document_id = $1
     ORDER BY dfs.page_number ASC NULLS LAST, dfs.span_start ASC NULLS LAST`,
    [documentId],
  );
  return rows.map(toFactSpanRow);
}

export async function insertExtraction(
  documentId: number,
  extractionMethod: string,
  textContent: string | null,
): Promise<{ id: number }> {
  const rows = await query<{ id: string }>(
    `INSERT INTO document_extractions (document_id, extraction_method, text_content)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [documentId, extractionMethod, textContent],
  );
  return { id: Number(rows[0]!.id) };
}

export async function insertFactSpan(
  extractionId: number,
  factType: string,
  factValue: string,
  pageNumber: number | null,
  confidence: string,
  sourceSnippet: string | null,
): Promise<{ id: number }> {
  const rows = await query<{ id: string }>(
    `INSERT INTO document_fact_spans (extraction_id, fact_type, fact_value, page_number, confidence, source_snippet)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [extractionId, factType, factValue, pageNumber, confidence, sourceSnippet],
  );
  return { id: Number(rows[0]!.id) };
}
