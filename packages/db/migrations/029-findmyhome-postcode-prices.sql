-- Migration 029: Clear the postal codes findmyhome stored as prices
--
-- Until 77c5ed5 the findmyhome parser took the first header value of a detail
-- page as the price. That value is the postal code, so these listings show a
-- price between 1,010 and 1,230 euros, and their price per sqm, score and price
-- history follow from it. The raw rows keep what the parser produced: on every
-- affected row, priceRaw is a bare Vienna postal code.
--
-- This clears those prices on the listings (price_per_sqm_eur follows, since it
-- is generated) and on their versions, and drops the scores computed from them.
-- It also clears last_detail_ok_at on the listings' sightings, so the detail
-- selection puts them first when discovery sees them again. Raw payloads and
-- score history stay as they are.

SET LOCAL statement_timeout = 0;

-- Rollback: not reversible, and nothing needs restoring. The values were postal
--   codes, and the next detail fetch of each listing stores its real price.
WITH postcode_prices AS (
  -- Raw rows whose price is a Vienna postal code (1010 to 1230), with that code in cents
  SELECT rl.id, (rl.raw_payload->>'priceRaw') || '00' AS cents
  FROM raw_listings rl
  JOIN sources s ON s.id = rl.source_id
  WHERE s.code = 'findmyhome'
    AND rl.raw_payload->>'priceRaw' ~ '^1(0[1-9]|1[0-9]|2[0-3])0$'
),
affected AS (
  SELECT l.id, l.source_id, l.source_listing_key
  FROM listings l
  JOIN postcode_prices p ON p.id = l.current_raw_listing_id
  WHERE l.list_price_eur_cents::text = p.cents
),
cleared_versions AS (
  UPDATE listing_versions v
  SET list_price_eur_cents = NULL, price_per_sqm_eur = NULL
  FROM postcode_prices p
  WHERE v.raw_listing_id = p.id
    AND v.list_price_eur_cents::text = p.cents
),
cleared_sightings AS (
  UPDATE raw_listing_sightings rs
  SET last_detail_ok_at = NULL
  FROM affected a
  WHERE rs.source_id = a.source_id
    AND rs.source_listing_key = a.source_listing_key
)
UPDATE listings l
SET list_price_eur_cents = NULL, current_score = NULL, last_scored_at = NULL
FROM affected a
WHERE l.id = a.id;
