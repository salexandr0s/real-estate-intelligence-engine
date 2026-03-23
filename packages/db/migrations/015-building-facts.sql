-- Migration 015: Building facts enrichment
--
-- Building-level data from official Vienna sources (e.g., Vienna OGD).
-- Used for listing analysis and as input to legal-rent assessment.

CREATE TABLE IF NOT EXISTS building_facts (
  id BIGSERIAL PRIMARY KEY,
  building_key TEXT NOT NULL,                    -- normalized address key
  source_name TEXT NOT NULL,                     -- e.g. 'vienna_ogd_gebaeude'
  source_record_id TEXT,                         -- ID in the source system
  address_text TEXT,                             -- display address from source
  lat NUMERIC(10,7),
  lon NUMERIC(10,7),
  match_confidence TEXT NOT NULL DEFAULT 'unknown',  -- exact/high/medium/low/unknown
  facts_json JSONB NOT NULL DEFAULT '{}',        -- year_built, typology, units, renovations, etc.
  source_updated_at TIMESTAMPTZ,                 -- when the source data was last updated
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (building_key, source_name)
);

CREATE INDEX IF NOT EXISTS idx_building_facts_location
  ON building_facts (lat, lon)
  WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- Link listings to building facts
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS building_fact_id BIGINT REFERENCES building_facts(id),
  ADD COLUMN IF NOT EXISTS building_match_confidence TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_building_fact
  ON listings (building_fact_id)
  WHERE building_fact_id IS NOT NULL;

COMMENT ON TABLE building_facts IS
  'Building-level enrichment data from official Vienna sources';
COMMENT ON COLUMN building_facts.building_key IS
  'Normalized address key for matching (street + house number, lowercased, trimmed)';
COMMENT ON COLUMN building_facts.facts_json IS
  'Structured building data: year_built, typology, unit_count, renovations, subsidies, etc.';
