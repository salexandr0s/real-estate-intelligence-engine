-- Cross-source listing clusters for duplicate detection and price comparison
BEGIN;

CREATE TABLE IF NOT EXISTS listing_clusters (
  id                   BIGSERIAL PRIMARY KEY,
  fingerprint          CHAR(64) NOT NULL,
  canonical_listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
  listing_count        INTEGER NOT NULL DEFAULT 1 CHECK (listing_count > 0),
  min_price_eur_cents  BIGINT,
  max_price_eur_cents  BIGINT,
  price_spread_pct     NUMERIC(8,4),
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_clusters_fingerprint UNIQUE (fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_listing_clusters_count
  ON listing_clusters (listing_count DESC)
  WHERE listing_count > 1;

CREATE TRIGGER trg_listing_clusters_updated_at
BEFORE UPDATE ON listing_clusters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS listing_cluster_members (
  id                   BIGSERIAL PRIMARY KEY,
  cluster_id           BIGINT NOT NULL REFERENCES listing_clusters(id) ON DELETE CASCADE,
  listing_id           BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source_id            BIGINT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  list_price_eur_cents BIGINT,
  added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_cluster_members UNIQUE (cluster_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_cluster_members_listing
  ON listing_cluster_members (listing_id);

COMMIT;
