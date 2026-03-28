-- Accelerate per-source lifecycle summary reads for explicit dead detections
-- (withdrawn / sold / rented) and stale expiry fallback (expired).

CREATE INDEX IF NOT EXISTS idx_listing_versions_lifecycle_listing_observed
  ON listing_versions (listing_id, observed_at DESC)
  WHERE version_reason = 'status_change'
    AND listing_status IN ('withdrawn', 'sold', 'rented', 'expired');
