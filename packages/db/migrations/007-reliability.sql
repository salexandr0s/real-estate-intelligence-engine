-- Reliability: extend alert types to support source degradation alerts
BEGIN;

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_alert_type_check
  CHECK (alert_type IN (
    'new_match', 'price_drop', 'price_change', 'score_upgrade',
    'status_change', 'digest', 'source_degraded'
  ));

COMMIT;
