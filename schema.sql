
-- schema.sql
-- PostgreSQL 15+
-- System of record for ImmoRadar.
-- Design goals:
--   * raw data preservation
--   * idempotent upserts
--   * strong indexing for filter queries
--   * current state + immutable history
--   * alert dedupe
--   * scoring explainability

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Utility trigger for updated_at columns
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- app_users
-- Optional in single-user deployments, but included for future multi-user growth.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_users (
  id                      BIGSERIAL PRIMARY KEY,
  email                   CITEXT UNIQUE,
  display_name            TEXT NOT NULL,
  timezone                TEXT NOT NULL DEFAULT 'Europe/Vienna',
  locale                  TEXT NOT NULL DEFAULT 'de-AT',
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  notification_settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sources
-- Registry of crawlable listing sources.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sources (
  id                        BIGSERIAL PRIMARY KEY,
  code                      TEXT NOT NULL UNIQUE,
  name                      TEXT NOT NULL,
  base_url                  TEXT NOT NULL,
  country_code              CHAR(2) NOT NULL DEFAULT 'AT',
  scrape_mode               TEXT NOT NULL DEFAULT 'browser'
                              CHECK (scrape_mode IN ('browser', 'http', 'api', 'feed')),
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  health_status             TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (health_status IN ('healthy', 'degraded', 'blocked', 'disabled', 'unknown')),
  crawl_interval_minutes    INTEGER NOT NULL DEFAULT 30
                              CHECK (crawl_interval_minutes > 0),
  priority                  INTEGER NOT NULL DEFAULT 100,
  rate_limit_rpm            INTEGER NOT NULL DEFAULT 12
                              CHECK (rate_limit_rpm > 0),
  concurrency_limit         INTEGER NOT NULL DEFAULT 1
                              CHECK (concurrency_limit > 0),
  parser_version            INTEGER NOT NULL DEFAULT 1
                              CHECK (parser_version > 0),
  legal_status              TEXT NOT NULL DEFAULT 'review_required'
                              CHECK (legal_status IN ('approved', 'review_required', 'disabled')),
  config                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_successful_run_at    TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_active_priority
  ON sources (is_active, priority, code);

CREATE TRIGGER trg_sources_updated_at
BEFORE UPDATE ON sources
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- scrape_runs
-- One row per bounded crawl unit / run.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scrape_runs (
  id                        BIGSERIAL PRIMARY KEY,
  run_uuid                  UUID NOT NULL DEFAULT gen_random_uuid(),
  source_id                 BIGINT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  trigger_type              TEXT NOT NULL
                              CHECK (trigger_type IN ('schedule', 'manual', 'backfill', 'retry', 'recovery')),
  scope                     TEXT NOT NULL
                              CHECK (scope IN ('discovery', 'detail', 'full')),
  status                    TEXT NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'rate_limited')),
  seed_name                 TEXT,
  seed_url                  TEXT,
  scheduled_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at                TIMESTAMPTZ,
  finished_at               TIMESTAMPTZ,
  worker_host               TEXT,
  worker_version            TEXT,
  browser_type              TEXT,
  browser_version           TEXT,
  pages_fetched             INTEGER NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  listings_discovered       INTEGER NOT NULL DEFAULT 0 CHECK (listings_discovered >= 0),
  raw_snapshots_created     INTEGER NOT NULL DEFAULT 0 CHECK (raw_snapshots_created >= 0),
  normalized_created        INTEGER NOT NULL DEFAULT 0 CHECK (normalized_created >= 0),
  normalized_updated        INTEGER NOT NULL DEFAULT 0 CHECK (normalized_updated >= 0),
  http_2xx                  INTEGER NOT NULL DEFAULT 0 CHECK (http_2xx >= 0),
  http_4xx                  INTEGER NOT NULL DEFAULT 0 CHECK (http_4xx >= 0),
  http_5xx                  INTEGER NOT NULL DEFAULT 0 CHECK (http_5xx >= 0),
  captcha_count             INTEGER NOT NULL DEFAULT 0 CHECK (captcha_count >= 0),
  retry_count               INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code                TEXT,
  error_message             TEXT,
  meta                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_scrape_runs_time_order
    CHECK (
      started_at IS NULL
      OR finished_at IS NULL
      OR finished_at >= started_at
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scrape_runs_run_uuid
  ON scrape_runs (run_uuid);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_source_scheduled
  ON scrape_runs (source_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_status_scheduled
  ON scrape_runs (status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_source_status_started
  ON scrape_runs (source_id, status, started_at DESC);

CREATE TRIGGER trg_scrape_runs_updated_at
BEFORE UPDATE ON scrape_runs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- raw_listings
-- Append-only unique raw snapshots per (source listing key + content hash).
-- Re-observing identical content updates last_seen_at and observation_count.
-- Full HTML/screenshots/HAR live in object storage referenced by storage keys.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_listings (
  id                        BIGSERIAL PRIMARY KEY,
  source_id                 BIGINT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_listing_key        TEXT NOT NULL,
  external_id               TEXT,
  canonical_url             TEXT NOT NULL,
  detail_url                TEXT NOT NULL,
  discovery_url             TEXT,
  payload_format            TEXT NOT NULL DEFAULT 'json'
                              CHECK (payload_format IN ('json', 'html', 'mixed')),
  extraction_status         TEXT NOT NULL DEFAULT 'captured'
                              CHECK (extraction_status IN ('captured', 'parse_failed', 'blocked', 'not_found')),
  response_status           INTEGER,
  response_headers          JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_storage_key          TEXT,
  screenshot_storage_key    TEXT,
  har_storage_key           TEXT,
  content_sha256            CHAR(64) NOT NULL,
  parser_version            INTEGER NOT NULL DEFAULT 1 CHECK (parser_version > 0),
  first_scrape_run_id       BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE RESTRICT,
  last_scrape_run_id        BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE RESTRICT,
  observed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observation_count         INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  is_deleted_at_source      BOOLEAN NOT NULL DEFAULT FALSE,
  meta                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_raw_listings_time_order
    CHECK (last_seen_at >= first_seen_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_listings_source_key_hash
  ON raw_listings (source_id, source_listing_key, content_sha256);

CREATE INDEX IF NOT EXISTS idx_raw_listings_source_key_seen
  ON raw_listings (source_id, source_listing_key, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_listings_last_scrape_run
  ON raw_listings (last_scrape_run_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_listings_external_id
  ON raw_listings (source_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_listings_created_brin
  ON raw_listings
  USING brin (created_at);

CREATE TRIGGER trg_raw_listings_updated_at
BEFORE UPDATE ON raw_listings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- listings
-- Current canonical state by source-local listing key.
-- This is the main search/filter table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listings (
  id                               BIGSERIAL PRIMARY KEY,
  listing_uid                      UUID NOT NULL DEFAULT gen_random_uuid(),
  source_id                        BIGINT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_listing_key               TEXT NOT NULL,
  source_external_id               TEXT,
  current_raw_listing_id           BIGINT NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
  latest_scrape_run_id             BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE RESTRICT,
  canonical_url                    TEXT NOT NULL,
  operation_type                   TEXT NOT NULL
                                     CHECK (operation_type IN ('sale', 'rent')),
  property_type                    TEXT NOT NULL
                                     CHECK (property_type IN ('apartment', 'house', 'land', 'commercial', 'parking', 'other')),
  property_subtype                 TEXT,
  listing_status                   TEXT NOT NULL DEFAULT 'active'
                                     CHECK (listing_status IN ('active', 'inactive', 'sold', 'rented', 'withdrawn', 'expired', 'unknown')),
  source_status_raw                TEXT,

  title                            TEXT NOT NULL,
  description                      TEXT,
  district_no                      SMALLINT
                                     CHECK (district_no IS NULL OR district_no BETWEEN 1 AND 23),
  district_name                    TEXT,
  postal_code                      VARCHAR(10)
                                     CHECK (postal_code IS NULL OR postal_code ~ '^[A-Za-z0-9 -]{2,10}$'),
  city                             TEXT NOT NULL,
  federal_state                    TEXT,
  street                           TEXT,
  house_number                     TEXT,
  address_display                  TEXT,
  latitude                         NUMERIC(9,6)
                                     CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude                        NUMERIC(9,6)
                                     CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  geocode_precision                TEXT
                                     CHECK (geocode_precision IS NULL OR geocode_precision IN ('source_exact', 'source_approx', 'street', 'district', 'city', 'none')),
  cross_source_fingerprint         CHAR(64),

  list_price_eur_cents             BIGINT CHECK (list_price_eur_cents IS NULL OR list_price_eur_cents >= 0),
  monthly_operating_cost_eur_cents BIGINT CHECK (monthly_operating_cost_eur_cents IS NULL OR monthly_operating_cost_eur_cents >= 0),
  reserve_fund_eur_cents           BIGINT CHECK (reserve_fund_eur_cents IS NULL OR reserve_fund_eur_cents >= 0),
  commission_eur_cents             BIGINT CHECK (commission_eur_cents IS NULL OR commission_eur_cents >= 0),

  living_area_sqm                  NUMERIC(10,2) CHECK (living_area_sqm IS NULL OR living_area_sqm > 0),
  usable_area_sqm                  NUMERIC(10,2) CHECK (usable_area_sqm IS NULL OR usable_area_sqm > 0),
  balcony_area_sqm                 NUMERIC(10,2) CHECK (balcony_area_sqm IS NULL OR balcony_area_sqm >= 0),
  terrace_area_sqm                 NUMERIC(10,2) CHECK (terrace_area_sqm IS NULL OR terrace_area_sqm >= 0),
  garden_area_sqm                  NUMERIC(10,2) CHECK (garden_area_sqm IS NULL OR garden_area_sqm >= 0),
  rooms                            NUMERIC(4,1) CHECK (rooms IS NULL OR rooms > 0),
  floor_label                      TEXT,
  floor_number                     SMALLINT,
  year_built                       INTEGER CHECK (year_built IS NULL OR year_built BETWEEN 1800 AND 2100),
  condition_category               TEXT,
  heating_type                     TEXT,
  energy_certificate_class         TEXT,

  has_balcony                      BOOLEAN,
  has_terrace                      BOOLEAN,
  has_garden                       BOOLEAN,
  has_elevator                     BOOLEAN,
  parking_available                BOOLEAN,
  is_furnished                     BOOLEAN,

  price_per_sqm_eur                NUMERIC(12,2) GENERATED ALWAYS AS (
                                     CASE
                                       WHEN list_price_eur_cents IS NOT NULL
                                         AND COALESCE(living_area_sqm, usable_area_sqm) IS NOT NULL
                                         AND COALESCE(living_area_sqm, usable_area_sqm) > 0
                                       THEN ROUND(
                                         (list_price_eur_cents::numeric / 100.0)
                                         / COALESCE(living_area_sqm, usable_area_sqm),
                                         2
                                       )
                                       ELSE NULL
                                     END
                                   ) STORED,

  completeness_score               NUMERIC(5,2) NOT NULL DEFAULT 0
                                     CHECK (completeness_score >= 0 AND completeness_score <= 100),
  current_score                    NUMERIC(5,2)
                                     CHECK (current_score IS NULL OR (current_score >= 0 AND current_score <= 100)),
  normalization_version            INTEGER NOT NULL DEFAULT 1 CHECK (normalization_version > 0),
  content_fingerprint              CHAR(64) NOT NULL,
  normalized_payload               JSONB NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_published_at               TIMESTAMPTZ,
  last_price_change_at             TIMESTAMPTZ,
  last_content_change_at           TIMESTAMPTZ,
  last_status_change_at            TIMESTAMPTZ,
  last_scored_at                   TIMESTAMPTZ,

  search_vector                    TSVECTOR GENERATED ALWAYS AS (
                                     to_tsvector(
                                       'german',
                                       COALESCE(title, '') || ' ' || COALESCE(description, '')
                                     )
                                   ) STORED,

  created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_listings_source_key UNIQUE (source_id, source_listing_key),
  CONSTRAINT uq_listings_uid UNIQUE (listing_uid),
  CONSTRAINT chk_listings_time_order CHECK (last_seen_at >= first_seen_at)
);

CREATE INDEX IF NOT EXISTS idx_listings_active_core_filter
  ON listings (operation_type, property_type, district_no, list_price_eur_cents, living_area_sqm, current_score DESC, first_seen_at DESC, id DESC)
  WHERE listing_status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_active_district_price
  ON listings (district_no, list_price_eur_cents, id DESC)
  WHERE listing_status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_active_district_area
  ON listings (district_no, living_area_sqm, id DESC)
  WHERE listing_status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_active_score_seen
  ON listings (current_score DESC, first_seen_at DESC, id DESC)
  WHERE listing_status = 'active';

CREATE INDEX IF NOT EXISTS idx_listings_active_status_seen
  ON listings (listing_status, first_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_listings_source_last_seen
  ON listings (source_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_listings_postal_code
  ON listings (postal_code)
  WHERE postal_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_cross_source_fingerprint
  ON listings (cross_source_fingerprint)
  WHERE cross_source_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_search_vector
  ON listings
  USING gin (search_vector);

CREATE TRIGGER trg_listings_updated_at
BEFORE UPDATE ON listings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- listing_versions
-- Immutable normalized history. One row per meaningful listing change.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listing_versions (
  id                        BIGSERIAL PRIMARY KEY,
  listing_id                BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  raw_listing_id            BIGINT NOT NULL REFERENCES raw_listings(id) ON DELETE RESTRICT,
  version_no                INTEGER NOT NULL CHECK (version_no > 0),
  version_reason            TEXT NOT NULL
                              CHECK (version_reason IN ('first_seen', 'price_change', 'content_change', 'status_change', 'relist_detected', 'backfill')),
  content_fingerprint       CHAR(64) NOT NULL,
  listing_status            TEXT NOT NULL
                              CHECK (listing_status IN ('active', 'inactive', 'sold', 'rented', 'withdrawn', 'expired', 'unknown')),
  list_price_eur_cents      BIGINT CHECK (list_price_eur_cents IS NULL OR list_price_eur_cents >= 0),
  living_area_sqm           NUMERIC(10,2) CHECK (living_area_sqm IS NULL OR living_area_sqm > 0),
  price_per_sqm_eur         NUMERIC(12,2),
  normalized_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_versions_listing_version UNIQUE (listing_id, version_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_versions_raw_listing
  ON listing_versions (raw_listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_versions_listing_observed
  ON listing_versions (listing_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_versions_created_brin
  ON listing_versions
  USING brin (created_at);

-- ---------------------------------------------------------------------------
-- market_baselines
-- Materialized-by-table baselines for scoring.
-- One row per date / district / property bucket.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS market_baselines (
  id                        BIGSERIAL PRIMARY KEY,
  baseline_date             DATE NOT NULL,
  city                      TEXT NOT NULL,
  district_no               SMALLINT
                              CHECK (district_no IS NULL OR district_no BETWEEN 1 AND 23),
  operation_type            TEXT NOT NULL
                              CHECK (operation_type IN ('sale', 'rent')),
  property_type             TEXT NOT NULL
                              CHECK (property_type IN ('apartment', 'house', 'land', 'commercial', 'parking', 'other')),
  area_bucket               TEXT NOT NULL,
  room_bucket               TEXT NOT NULL,
  source_scope              TEXT NOT NULL DEFAULT 'all_sources',
  sample_size               INTEGER NOT NULL CHECK (sample_size >= 0),
  median_ppsqm_eur          NUMERIC(12,2) NOT NULL CHECK (median_ppsqm_eur >= 0),
  trimmed_mean_ppsqm_eur    NUMERIC(12,2),
  p25_ppsqm_eur             NUMERIC(12,2),
  p75_ppsqm_eur             NUMERIC(12,2),
  stddev_ppsqm_eur          NUMERIC(12,2),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_market_baselines_dim UNIQUE (
    baseline_date,
    city,
    district_no,
    operation_type,
    property_type,
    area_bucket,
    room_bucket,
    source_scope
  )
);

CREATE INDEX IF NOT EXISTS idx_market_baselines_lookup
  ON market_baselines (baseline_date DESC, district_no, operation_type, property_type, area_bucket, room_bucket);

CREATE TRIGGER trg_market_baselines_updated_at
BEFORE UPDATE ON market_baselines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- listing_scores
-- Detailed scoring history / explanations.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listing_scores (
  id                           BIGSERIAL PRIMARY KEY,
  listing_id                   BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_version_id           BIGINT NOT NULL REFERENCES listing_versions(id) ON DELETE CASCADE,
  score_version                INTEGER NOT NULL DEFAULT 1 CHECK (score_version > 0),
  overall_score                NUMERIC(5,2) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  district_price_score         NUMERIC(5,2) NOT NULL CHECK (district_price_score >= 0 AND district_price_score <= 100),
  undervaluation_score         NUMERIC(5,2) NOT NULL CHECK (undervaluation_score >= 0 AND undervaluation_score <= 100),
  keyword_signal_score         NUMERIC(5,2) NOT NULL CHECK (keyword_signal_score >= 0 AND keyword_signal_score <= 100),
  time_on_market_score         NUMERIC(5,2) NOT NULL CHECK (time_on_market_score >= 0 AND time_on_market_score <= 100),
  confidence_score             NUMERIC(5,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  district_baseline_ppsqm_eur  NUMERIC(12,2),
  bucket_baseline_ppsqm_eur    NUMERIC(12,2),
  discount_to_district_pct     NUMERIC(8,4),
  discount_to_bucket_pct       NUMERIC(8,4),
  matched_positive_keywords    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  matched_negative_keywords    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  explanation                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  scored_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_scores_version UNIQUE (listing_version_id, score_version)
);

CREATE INDEX IF NOT EXISTS idx_listing_scores_listing_scored
  ON listing_scores (listing_id, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_scores_overall
  ON listing_scores (overall_score DESC, scored_at DESC);

-- ---------------------------------------------------------------------------
-- user_filters
-- Persisted filter definitions for interactive search and background alerts.
-- Store both JSON and flattened typed columns for performance.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_filters (
  id                        BIGSERIAL PRIMARY KEY,
  user_id                   BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  filter_kind               TEXT NOT NULL DEFAULT 'alert'
                              CHECK (filter_kind IN ('listing_search', 'alert')),
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  operation_type            TEXT
                              CHECK (operation_type IS NULL OR operation_type IN ('sale', 'rent')),
  property_types            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  districts                 SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  postal_codes              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_price_eur_cents       BIGINT CHECK (min_price_eur_cents IS NULL OR min_price_eur_cents >= 0),
  max_price_eur_cents       BIGINT CHECK (max_price_eur_cents IS NULL OR max_price_eur_cents >= 0),
  min_area_sqm              NUMERIC(10,2) CHECK (min_area_sqm IS NULL OR min_area_sqm >= 0),
  max_area_sqm              NUMERIC(10,2) CHECK (max_area_sqm IS NULL OR max_area_sqm >= 0),
  min_rooms                 NUMERIC(4,1) CHECK (min_rooms IS NULL OR min_rooms >= 0),
  max_rooms                 NUMERIC(4,1) CHECK (max_rooms IS NULL OR max_rooms >= 0),
  required_keywords         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  excluded_keywords         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_score                 NUMERIC(5,2) CHECK (min_score IS NULL OR (min_score >= 0 AND min_score <= 100)),
  sort_by                   TEXT NOT NULL DEFAULT 'score_desc'
                              CHECK (sort_by IN ('score_desc', 'newest', 'price_asc', 'price_desc', 'sqm_desc')),
  alert_frequency           TEXT NOT NULL DEFAULT 'instant'
                              CHECK (alert_frequency IN ('instant', 'hourly_digest', 'daily_digest', 'manual')),
  alert_channels            TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  criteria_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_evaluated_at         TIMESTAMPTZ,
  last_match_at             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_filters_price_range
    CHECK (
      min_price_eur_cents IS NULL
      OR max_price_eur_cents IS NULL
      OR max_price_eur_cents >= min_price_eur_cents
    ),
  CONSTRAINT chk_user_filters_area_range
    CHECK (
      min_area_sqm IS NULL
      OR max_area_sqm IS NULL
      OR max_area_sqm >= min_area_sqm
    ),
  CONSTRAINT chk_user_filters_rooms_range
    CHECK (
      min_rooms IS NULL
      OR max_rooms IS NULL
      OR max_rooms >= min_rooms
    )
);

CREATE INDEX IF NOT EXISTS idx_user_filters_user_active
  ON user_filters (user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_filters_active_core
  ON user_filters (is_active, operation_type, max_price_eur_cents, min_area_sqm, min_score);

CREATE INDEX IF NOT EXISTS idx_user_filters_districts_gin
  ON user_filters
  USING gin (districts);

CREATE INDEX IF NOT EXISTS idx_user_filters_property_types_gin
  ON user_filters
  USING gin (property_types);

CREATE INDEX IF NOT EXISTS idx_user_filters_required_keywords_gin
  ON user_filters
  USING gin (required_keywords);

CREATE TRIGGER trg_user_filters_updated_at
BEFORE UPDATE ON user_filters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- alerts
-- Alert event and delivery state. One row per deduped listing/filter/channel event.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts (
  id                        BIGSERIAL PRIMARY KEY,
  user_id                   BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_filter_id            BIGINT NOT NULL REFERENCES user_filters(id) ON DELETE CASCADE,
  listing_id                BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_version_id        BIGINT REFERENCES listing_versions(id) ON DELETE SET NULL,
  alert_type                TEXT NOT NULL
                              CHECK (alert_type IN ('new_match', 'price_drop', 'price_change', 'score_upgrade', 'status_change', 'digest')),
  channel                   TEXT NOT NULL
                              CHECK (channel IN ('in_app', 'email', 'push', 'webhook')),
  status                    TEXT NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'sent', 'failed', 'dismissed', 'opened', 'suppressed')),
  dedupe_key                TEXT NOT NULL,
  title                     TEXT NOT NULL,
  body                      TEXT NOT NULL,
  payload                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at                   TIMESTAMPTZ,
  error_message             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_dedupe_channel
  ON alerts (dedupe_key, channel);

CREATE INDEX IF NOT EXISTS idx_alerts_user_status_scheduled
  ON alerts (user_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_alerts_filter_matched
  ON alerts (user_filter_id, matched_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_listing_matched
  ON alerts (listing_id, matched_at DESC);

CREATE TRIGGER trg_alerts_updated_at
BEFORE UPDATE ON alerts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
