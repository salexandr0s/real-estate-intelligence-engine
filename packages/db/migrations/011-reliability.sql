-- Dead letter queue for jobs that exhaust retries.
-- Provides visibility into permanently failed scraping/processing jobs.

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id              BIGSERIAL PRIMARY KEY,
  queue_name      TEXT NOT NULL,
  job_id          TEXT NOT NULL,
  job_data        JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  error_class     TEXT,
  source_code     TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_queue ON dead_letter_jobs (queue_name, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_source ON dead_letter_jobs (source_code, failed_at DESC);

-- Index for stale listing detection queries
CREATE INDEX IF NOT EXISTS idx_listings_active_last_seen
  ON listings (last_seen_at ASC) WHERE listing_status = 'active';

-- Canary health check results.
-- Records end-to-end pipeline health probes per source.

CREATE TABLE IF NOT EXISTS canary_results (
  id              BIGSERIAL PRIMARY KEY,
  source_code     TEXT NOT NULL,
  success         BOOLEAN NOT NULL,
  discovery_ok    BOOLEAN NOT NULL DEFAULT FALSE,
  detail_ok       BOOLEAN NOT NULL DEFAULT FALSE,
  ingestion_ok    BOOLEAN NOT NULL DEFAULT FALSE,
  scoring_ok      BOOLEAN NOT NULL DEFAULT FALSE,
  listings_found  INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canary_results_source ON canary_results (source_code, created_at DESC);
