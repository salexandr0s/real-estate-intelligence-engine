-- Migration 023: Allow several listing versions per raw snapshot
--
-- A lifecycle change reached without a new detail page (the stale check) reuses
-- the listing's current raw snapshot, and content that changes from A to B and
-- back to A returns to an older snapshot. The unique index rejected both.
--
-- Rollback: remove the extra versions per raw_listing_id, then
--   CREATE UNIQUE INDEX uq_listing_versions_raw_listing ON listing_versions (raw_listing_id);
--   DROP INDEX idx_listing_versions_raw_listing;

SET LOCAL statement_timeout = 0;

DROP INDEX IF EXISTS uq_listing_versions_raw_listing;

CREATE INDEX IF NOT EXISTS idx_listing_versions_raw_listing
  ON listing_versions (raw_listing_id);
