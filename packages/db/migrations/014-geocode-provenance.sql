-- ---------------------------------------------------------------------------
-- 014-geocode-provenance.sql
-- Adds geocode provenance to listings and baseline provenance to
-- listing_scores for debugging and transparency.
-- ---------------------------------------------------------------------------

-- 1. Geocode provenance on listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS
  geocode_source TEXT;

ALTER TABLE listings ADD COLUMN IF NOT EXISTS
  geocode_updated_at TIMESTAMPTZ;

-- 2. Baseline provenance on listing_scores
ALTER TABLE listing_scores ADD COLUMN IF NOT EXISTS
  baseline_fallback_level TEXT;

ALTER TABLE listing_scores ADD COLUMN IF NOT EXISTS
  baseline_sample_size INT;

ALTER TABLE listing_scores ADD COLUMN IF NOT EXISTS
  baseline_freshness_hours NUMERIC;
