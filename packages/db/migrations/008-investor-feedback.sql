BEGIN;

CREATE TABLE IF NOT EXISTS investor_feedback (
  id          BIGSERIAL PRIMARY KEY,
  listing_id  BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  rating      TEXT NOT NULL CHECK (rating IN ('interested', 'not_interested', 'bookmarked', 'contacted')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_investor_feedback UNIQUE (listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_feedback_user
  ON investor_feedback (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_investor_feedback_listing
  ON investor_feedback (listing_id);

CREATE TRIGGER trg_investor_feedback_updated_at
BEFORE UPDATE ON investor_feedback
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
