-- Migration 026: Accept 'estimated' geocodes and back off failed geocoding
--
-- The geocoder writes 'estimated' for the midpoint of several streets or
-- stations. The CHECK from 001 rejected that value, so those coordinate updates
-- failed. The new CHECK accepts exactly the GeocodePrecision values in
-- packages/contracts, and NULL as before.
--
-- geocode_attempts counts the geocoding jobs enqueued for a listing and
-- geocode_next_attempt_at holds the next one back, so a listing that never
-- geocodes stops getting a job every hour. Existing rows start at 0 attempts
-- with nothing to wait for.

SET LOCAL statement_timeout = 0;

-- Rollback: move 'estimated' rows to 'district', the nearest coarser value, then
--   put back the 001 CHECK:
--   UPDATE listings SET geocode_precision = 'district' WHERE geocode_precision = 'estimated';
--   ALTER TABLE listings
--     DROP CONSTRAINT IF EXISTS listings_geocode_precision_check,
--     ADD CONSTRAINT listings_geocode_precision_check CHECK (
--       geocode_precision IS NULL OR geocode_precision IN
--         ('source_exact', 'source_approx', 'street', 'district', 'city', 'none'));
ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_geocode_precision_check,
  ADD CONSTRAINT listings_geocode_precision_check CHECK (
    geocode_precision IS NULL OR geocode_precision IN
      ('source_exact', 'source_approx', 'street', 'estimated', 'district', 'city', 'none'));

-- Rollback: ALTER TABLE listings DROP COLUMN IF EXISTS geocode_attempts;
--   (once no code reads or writes it, per rule 1)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS geocode_attempts SMALLINT NOT NULL DEFAULT 0;

-- Rollback: ALTER TABLE listings DROP COLUMN IF EXISTS geocode_next_attempt_at;
--   (once no code reads or writes it, per rule 1)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS geocode_next_attempt_at TIMESTAMPTZ;
