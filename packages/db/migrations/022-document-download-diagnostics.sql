-- Migration 022: Document download diagnostics
--
-- Persist structured failure details for document download policy and
-- network errors so operators can diagnose blocked downloads.

ALTER TABLE listing_documents
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;
