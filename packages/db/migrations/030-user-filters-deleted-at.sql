-- Migration 030: Tell a deleted filter from a paused one
--
-- DELETE /v1/filters/:id set is_active = false, the same flag the pause toggle sets,
-- and the list showed active filters only, so pausing a filter hid it like a delete.
-- deleted_at now marks a deleted filter, and is_active only says whether it alerts.
-- The app never showed an inactive filter, so every inactive row that exists now
-- counts as deleted, dated by its last update. The visible list stays the same.

SET LOCAL statement_timeout = 0;

-- Rollback: ALTER TABLE user_filters DROP COLUMN IF EXISTS deleted_at;
--   (once no code reads or writes it, per rule 1)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_filters'
      AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE user_filters ADD COLUMN deleted_at TIMESTAMPTZ;
    -- Backfill only with the new column, so a rerun can't delete a filter paused later.
    UPDATE user_filters SET deleted_at = updated_at WHERE is_active = FALSE;
  END IF;
END $$;
