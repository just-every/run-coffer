-- Attendance is opt-in scoring: existing policies retain all their weights.
DROP TRIGGER cf_engagement_settings_score_insert;
DROP TRIGGER cf_engagement_settings_score_update;
DROP TRIGGER cf_engagement_settings_score_delete;
ALTER TABLE cf_engagement_settings RENAME TO cf_engagement_settings_before_attendance;
CREATE TABLE cf_engagement_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version>=2),
 recency INTEGER NOT NULL CHECK(recency BETWEEN 0 AND 100),
 frequency INTEGER NOT NULL CHECK(frequency BETWEEN 0 AND 100),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 100),
 conversations INTEGER NOT NULL CHECK(conversations BETWEEN 0 AND 100),
 volunteering INTEGER NOT NULL DEFAULT 0 CHECK(volunteering BETWEEN 0 AND 100),
 attendance INTEGER NOT NULL DEFAULT 0 CHECK(attendance BETWEEN 0 AND 100),
 opens INTEGER NOT NULL DEFAULT 0 CHECK(opens BETWEEN 0 AND 100),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
 CHECK(recency+frequency+amount+conversations+volunteering+attendance+opens=100)
);
INSERT INTO cf_engagement_settings
 SELECT id,version,recency,frequency,amount,conversations,volunteering,0,opens,updated_at,updated_by
 FROM cf_engagement_settings_before_attendance;
DROP TABLE cf_engagement_settings_before_attendance;
CREATE TRIGGER cf_engagement_settings_score_insert AFTER INSERT ON cf_engagement_settings BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_engagement_settings_score_update AFTER UPDATE ON cf_engagement_settings BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_engagement_settings_score_delete AFTER DELETE ON cf_engagement_settings BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_event_registrations_score_insert AFTER INSERT ON cf_event_registrations BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_event_registrations_score_update AFTER UPDATE ON cf_event_registrations BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_event_registrations_score_delete AFTER DELETE ON cf_event_registrations BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
UPDATE cf_score_clock SET revision=revision+1 WHERE id=1;
