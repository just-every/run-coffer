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
-- Existing AGENT-001 keys retain their fixed all-record read/preparation
-- permissions, now with a real named, metered preparation grant. No sending.
CREATE TABLE cf_agent_preparation_grants (
 id TEXT PRIMARY KEY,
 key_id TEXT NOT NULL UNIQUE REFERENCES cf_agent_keys(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 read_limit INTEGER NOT NULL DEFAULT 10000 CHECK(read_limit BETWEEN 1 AND 1000000),
 prepare_limit INTEGER NOT NULL DEFAULT 500 CHECK(prepare_limit BETWEEN 1 AND 10000)
);
INSERT INTO cf_agent_preparation_grants(id,key_id,name)
 SELECT 'preparation:'||id,id,label||' preparation' FROM cf_agent_keys;
CREATE TABLE cf_agent_preparation_usage (
 grant_id TEXT NOT NULL REFERENCES cf_agent_preparation_grants(id),
 day TEXT NOT NULL,
 reads INTEGER NOT NULL DEFAULT 0 CHECK(reads>=0),
 preparations INTEGER NOT NULL DEFAULT 0 CHECK(preparations>=0),
 PRIMARY KEY(grant_id,day)
);
CREATE TRIGGER cf_agent_preparation_key AFTER INSERT ON cf_agent_keys
BEGIN
 INSERT INTO cf_agent_preparation_grants(id,key_id,name)
 VALUES('preparation:'||NEW.id,NEW.id,NEW.label||' preparation');
END;
