-- Migration 028: Cross-source fingerprints need a street
--
-- A fingerprint built from postal code and city alone is shared by unrelated
-- listings in the same district, and the false clusters it creates suppress
-- their alerts. Normalization no longer computes one without a street, and the
-- listing upsert now stores whatever it computes. Listings that aren't fetched
-- again would keep their old values, so they are cleared here. The next cluster
-- job then deletes the clusters that were built on them.

SET LOCAL statement_timeout = 0;

-- Rollback: not reversible, and nothing needs restoring. These fingerprints
--   matched every listing in the district, and the next ingest of a listing
--   that has a street computes its fingerprint again.
UPDATE listings
SET cross_source_fingerprint = NULL
WHERE (street IS NULL OR btrim(street) = '')
  AND cross_source_fingerprint IS NOT NULL;
