-- PG NOTIFY trigger for real-time alert delivery via SSE.
-- Fires on every INSERT to the alerts table, sending user_id:alert_id as payload.

CREATE OR REPLACE FUNCTION notify_alert_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('alert_created', NEW.user_id || ':' || NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alert_notify ON alerts;

CREATE TRIGGER trg_alert_notify
AFTER INSERT ON alerts
FOR EACH ROW
EXECUTE FUNCTION notify_alert_created();
