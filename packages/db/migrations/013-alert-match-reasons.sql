-- Migration 013: Alert match reasons and cluster-aware dedup
--
-- Adds structured match explanations to alerts so users can see
-- why a listing matched their filter. Also adds cluster fingerprint
-- for cross-source alert dedup.

-- 1. Match reasons — structured JSON explaining which filter criteria matched
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS match_reasons_json JSONB;

-- 2. Cluster fingerprint — allows dedup across cross-source duplicate listings
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS cluster_fingerprint CHAR(64);

-- Index for cluster-aware dedup lookups:
-- "Has another alert already been created for this filter + cluster + type?"
CREATE INDEX IF NOT EXISTS idx_alerts_cluster_dedup
  ON alerts (user_filter_id, cluster_fingerprint, alert_type)
  WHERE cluster_fingerprint IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN alerts.match_reasons_json IS
  'Structured JSON explaining which filter criteria the listing matched: keywords, district, price/area thresholds, score';
COMMENT ON COLUMN alerts.cluster_fingerprint IS
  'Cross-source cluster fingerprint for deduplicating alerts across listings that represent the same property';
