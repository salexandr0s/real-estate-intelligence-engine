-- Delist active listings that are not in Vienna.
-- Non-Vienna listings have district_no = NULL because the district resolver
-- only maps Vienna postal codes (1010-1230).
UPDATE listings
SET listing_status = 'delisted',
    last_status_change_at = NOW()
WHERE district_no IS NULL
  AND postal_code IS NOT NULL
  AND listing_status = 'active';
