-- Migration 017: Document ingestion and fact extraction
--
-- Documents (PDFs, images) attached to listings.
-- Extracted facts retain full provenance (document, page, position, confidence).

-- 1. Document storage
CREATE TABLE IF NOT EXISTS listing_documents (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES listings(id),
  url TEXT NOT NULL,                             -- original URL of the document
  checksum CHAR(64),                             -- SHA256 of downloaded content
  mime_type TEXT,
  size_bytes BIGINT,
  storage_key TEXT,                              -- S3/MinIO object key
  document_type TEXT NOT NULL DEFAULT 'unknown',  -- expose/floorplan/energy_cert/other/unknown
  status TEXT NOT NULL DEFAULT 'pending',          -- pending/downloaded/extracted/failed
  page_count INT,
  label TEXT,                                    -- source-provided label
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, checksum)
);

CREATE INDEX IF NOT EXISTS idx_listing_documents_listing
  ON listing_documents (listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_documents_status
  ON listing_documents (status)
  WHERE status != 'extracted';

-- 2. Extraction results
CREATE TABLE IF NOT EXISTS document_extractions (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES listing_documents(id),
  extraction_method TEXT NOT NULL,               -- pdf_text/ocr/manual
  text_content TEXT,                             -- full extracted text
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_extractions_document
  ON document_extractions (document_id);

-- 3. Fact spans — individual facts extracted with full provenance
CREATE TABLE IF NOT EXISTS document_fact_spans (
  id BIGSERIAL PRIMARY KEY,
  extraction_id BIGINT NOT NULL REFERENCES document_extractions(id),
  fact_type TEXT NOT NULL,                       -- rent/fees/area/rooms/floor/energy/building_year/condition/outdoor_space/heating/tenancy_note
  fact_value TEXT NOT NULL,                      -- extracted value (text representation)
  page_number INT,                               -- which page the fact was found on
  span_start INT,                                -- character offset in extracted text
  span_end INT,
  confidence TEXT NOT NULL DEFAULT 'medium',      -- high/medium/low
  source_snippet TEXT,                           -- surrounding text for verification
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_fact_spans_extraction
  ON document_fact_spans (extraction_id);

CREATE INDEX IF NOT EXISTS idx_document_fact_spans_type
  ON document_fact_spans (fact_type);

COMMENT ON TABLE listing_documents IS
  'Documents attached to listings — PDFs, images, energy certificates';
COMMENT ON TABLE document_extractions IS
  'Text extraction results from documents (PDF native or OCR)';
COMMENT ON TABLE document_fact_spans IS
  'Individual facts extracted from documents with full provenance — page, position, confidence, source snippet';
