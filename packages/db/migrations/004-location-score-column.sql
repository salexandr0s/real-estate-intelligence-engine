-- Migration 004: Add location_score column to listing_scores
-- Supports the new location-based scoring sub-component (score v2)

ALTER TABLE listing_scores ADD COLUMN IF NOT EXISTS location_score NUMERIC(5,2)
  CHECK (location_score IS NULL OR (location_score >= 0 AND location_score <= 100));
