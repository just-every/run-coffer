CREATE TABLE cf_sms_schedules (
 run_id TEXT PRIMARY KEY REFERENCES cf_sms_runs(id) ON DELETE CASCADE,
 scheduled_at TEXT NOT NULL,
 scheduled_by TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('scheduled','paused','complete','cancelled')),
 note TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL
);
CREATE TRIGGER cf_sms_schedule_stop AFTER UPDATE OF state ON cf_sms_runs
WHEN NEW.state IN ('discarded','redacted') BEGIN
 UPDATE cf_sms_schedules SET state='cancelled',note='The text run was discarded or redacted.' WHERE run_id=NEW.id;
END;
