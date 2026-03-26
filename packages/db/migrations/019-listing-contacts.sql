-- Migration 019: canonical listing contact fields
--
-- Stores broker/agent contact details on the current-state listings table.
-- Historical contact changes remain preserved in listing_versions.normalized_snapshot.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_company TEXT,
  ADD COLUMN IF NOT EXISTS contact_email CITEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_contact_email
  ON listings (contact_email)
  WHERE contact_email IS NOT NULL;
