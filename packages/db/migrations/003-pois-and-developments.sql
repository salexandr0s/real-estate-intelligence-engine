-- Migration 003: POIs and Wien developments tables
-- Supports location intelligence scoring and map features

CREATE TABLE IF NOT EXISTS pois (
  id            BIGSERIAL PRIMARY KEY,
  source_id     TEXT NOT NULL,
  external_key  TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('transit','park','school','police')),
  subcategory   TEXT,
  name          TEXT NOT NULL,
  latitude      NUMERIC(9,6) NOT NULL,
  longitude     NUMERIC(9,6) NOT NULL,
  district_no   SMALLINT,
  properties    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pois_source_key UNIQUE (source_id, external_key)
);
CREATE INDEX IF NOT EXISTS idx_pois_category ON pois (category);
CREATE INDEX IF NOT EXISTS idx_pois_location ON pois (latitude, longitude);

CREATE TABLE IF NOT EXISTS wien_developments (
  id            BIGSERIAL PRIMARY KEY,
  external_key  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unknown',
  description   TEXT,
  category      TEXT,
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  geometry      JSONB,
  source_url    TEXT,
  properties    JSONB NOT NULL DEFAULT '{}',
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wien_dev_status ON wien_developments (status);
