-- Migration 025: Keep legally disabled sources inactive
--
-- A source with legal_status 'disabled' must never run, but is_active could
-- still say TRUE. This turns those sources off and adds a CHECK so the two
-- columns can't disagree again.
--
-- Active sources that old failures left degraded, blocked or disabled restart
-- as 'unknown', so each gets one run with the new page navigation. Failures
-- older than 14 days no longer count toward health, so old history can't
-- disable a source on its first new run.
--
-- Rollback: ALTER TABLE sources DROP CONSTRAINT IF EXISTS chk_sources_legal_disabled_inactive;
--   The is_active and health_status updates are data repairs and stay.

SET LOCAL statement_timeout = 0;

UPDATE sources
SET is_active = FALSE
WHERE legal_status = 'disabled'
  AND is_active;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'sources'::regclass
      AND conname = 'chk_sources_legal_disabled_inactive'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT chk_sources_legal_disabled_inactive
      CHECK (NOT (is_active AND legal_status = 'disabled'));
  END IF;
END $$;

UPDATE sources
SET health_status = 'unknown'
WHERE is_active
  AND health_status IN ('degraded', 'blocked', 'disabled');
