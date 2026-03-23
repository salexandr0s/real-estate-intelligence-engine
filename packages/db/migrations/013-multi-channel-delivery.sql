-- ---------------------------------------------------------------------------
-- 013-multi-channel-delivery.sql
-- Adds device_tokens table, fixes alert_type CHECK constraint, and adds
-- delivery worker index for multi-channel alert delivery.
-- ---------------------------------------------------------------------------

-- 1. Device tokens for push notifications (APNs)
CREATE TABLE IF NOT EXISTS device_tokens (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('apns', 'apns_sandbox')),
  app_version   TEXT,
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_tokens_user_token
  ON device_tokens (user_id, token);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON device_tokens (user_id);

-- 2. Fix alert_type CHECK constraint — domain.ts defines 'price_change' and
--    'source_degraded' but the original migration only allows 5 types.
--    score-and-alert.ts:308 can return 'price_change' which causes INSERT failure.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_alert_type_check
  CHECK (alert_type IN (
    'new_match', 'price_drop', 'price_change',
    'score_upgrade', 'status_change', 'digest', 'source_degraded'
  ));

-- 3. Partial index for delivery worker to efficiently find pending non-in_app alerts
CREATE INDEX IF NOT EXISTS idx_alerts_channel_status_queued
  ON alerts (channel, status)
  WHERE status = 'queued' AND channel != 'in_app';
