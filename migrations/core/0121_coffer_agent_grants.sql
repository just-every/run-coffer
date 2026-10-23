-- Named grants never revert to legacy preparation authority when disabled.
CREATE TABLE cf_agent_grants (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 donor_ids TEXT NOT NULL CHECK(json_valid(donor_ids)),
 permissions TEXT NOT NULL CHECK(json_valid(permissions)),
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000),
 settings_version INTEGER,
 template_revision INTEGER,
 approved_by_id TEXT NOT NULL,
 approved_by_name TEXT NOT NULL,
 approved_by_role TEXT NOT NULL CHECK(approved_by_role IN ('owner','admin')),
 approver_version INTEGER NOT NULL,
 updated_at TEXT NOT NULL
);
ALTER TABLE cf_agent_keys ADD COLUMN grant_id TEXT REFERENCES cf_agent_grants(id);
CREATE TABLE cf_agent_grant_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
INSERT INTO cf_agent_grant_control(id,enabled) VALUES(1,1);
CREATE TABLE cf_agent_grant_usage (
 grant_id TEXT NOT NULL REFERENCES cf_agent_grants(id),
 day TEXT NOT NULL,
 reserved INTEGER NOT NULL CHECK(reserved>=0),
 PRIMARY KEY(grant_id,day)
);
-- A dispatch claim is never automatically retried after interruption.
CREATE TABLE cf_agent_grant_dispatches (
 batch_id TEXT PRIMARY KEY REFERENCES cf_ack_batches(id),
 grant_id TEXT NOT NULL REFERENCES cf_agent_grants(id),
 grant_version INTEGER NOT NULL,
 letters INTEGER NOT NULL,
 claimed_at TEXT NOT NULL
);
