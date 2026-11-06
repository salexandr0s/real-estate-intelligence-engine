-- Migration 024: Record discovery sightings in the raw layer
--
-- raw_listings has one row per content hash and none before the first detail
-- fetch, so it can't say "discovery saw this key in run N". The scraper writes
-- the sighting columns, and processing writes the detail outcome columns. A
-- listing leaves 'active' only on evidence from its own detail page.
--
-- The backfill starts every counter at 0 and leaves last_sighted_at NULL, so
-- imported listings are neither new nor expiry candidates. A key with a listing
-- row counts as having had a good detail page whatever its raw status says,
-- because a whole-page anti-bot regex marked good wohnnet captures as blocked.
--
-- Rollback: DROP TABLE raw_listing_sightings;

SET LOCAL statement_timeout = 0;

CREATE TABLE IF NOT EXISTS raw_listing_sightings (
  source_id                BIGINT NOT NULL REFERENCES sources(id),
  source_listing_key       TEXT NOT NULL,
  detail_url               TEXT NOT NULL,
  discovery_url            TEXT,
  first_sighted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sighted_at          TIMESTAMPTZ,
  last_sighted_run_id      BIGINT,
  summary_sha256           CHAR(64),
  summary_changed_at       TIMESTAMPTZ,
  last_detail_enqueued_at  TIMESTAMPTZ,
  next_detail_at           TIMESTAMPTZ,
  last_detail_ok_at        TIMESTAMPTZ,
  inconclusive_count       SMALLINT NOT NULL DEFAULT 0,
  last_inconclusive_at     TIMESTAMPTZ,
  PRIMARY KEY (source_id, source_listing_key)
);

CREATE INDEX IF NOT EXISTS idx_raw_listing_sightings_next_detail
  ON raw_listing_sightings (source_id, next_detail_at);

INSERT INTO raw_listing_sightings (
  source_id, source_listing_key, detail_url, discovery_url, first_sighted_at, last_detail_ok_at
)
SELECT DISTINCT ON (r.source_id, r.source_listing_key)
  r.source_id,
  r.source_listing_key,
  r.detail_url,
  r.discovery_url,
  r.first_seen_at,
  CASE WHEN r.extraction_status = 'captured' OR l.id IS NOT NULL THEN r.last_seen_at END
FROM raw_listings r
LEFT JOIN listings l
  ON l.source_id = r.source_id AND l.source_listing_key = r.source_listing_key
ORDER BY r.source_id, r.source_listing_key, r.last_seen_at DESC
ON CONFLICT (source_id, source_listing_key) DO NOTHING;
