-- Cache the 2 closest POIs per category per listing.
-- Populated by the scoring pipeline after proximity computation.
-- ~20 rows per geocoded listing (10 categories × 2).

CREATE TABLE IF NOT EXISTS listing_pois (
  id            BIGSERIAL PRIMARY KEY,
  listing_id    BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  poi_id        BIGINT NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  poi_name      TEXT NOT NULL,
  distance_m    NUMERIC(10,2) NOT NULL,
  rank          SMALLINT NOT NULL CHECK (rank IN (1, 2)),
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_poi_category_rank UNIQUE (listing_id, category, rank)
);

CREATE INDEX IF NOT EXISTS idx_listing_pois_listing ON listing_pois (listing_id);
