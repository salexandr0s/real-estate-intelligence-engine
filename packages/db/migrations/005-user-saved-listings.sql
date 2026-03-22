-- Watchlist: user-saved listings for bookmarking/tracking
BEGIN;

CREATE TABLE IF NOT EXISTS user_saved_listings (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  listing_id  BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  notes       TEXT,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_saved_listings UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_listings_user
  ON user_saved_listings (user_id, saved_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_saved_listings_listing
  ON user_saved_listings (listing_id);

CREATE TRIGGER trg_user_saved_listings_updated_at
BEFORE UPDATE ON user_saved_listings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
