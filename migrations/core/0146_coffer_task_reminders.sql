ALTER TABLE cf_call_tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'call' CHECK(task_kind IN ('call','meeting','thank_you','follow_up','data_fix'));
ALTER TABLE cf_call_tasks ADD COLUMN gift_id TEXT REFERENCES cf_gifts(id) ON DELETE SET NULL;
ALTER TABLE cf_call_tasks ADD COLUMN prospect_id TEXT REFERENCES cf_prospects(id) ON DELETE SET NULL;
ALTER TABLE cf_call_tasks ADD COLUMN completion_notes TEXT;
CREATE TABLE cf_task_policy (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1, escalation_days INTEGER NOT NULL DEFAULT 2 CHECK(escalation_days BETWEEN 1 AND 30));
INSERT INTO cf_task_policy(id) VALUES(1);
CREATE TABLE cf_task_reminder_preferences (operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id) ON DELETE CASCADE, email_enabled INTEGER NOT NULL CHECK(email_enabled IN (0,1)));
CREATE TABLE cf_task_notices (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES cf_call_tasks(id) ON DELETE CASCADE,
 task_version INTEGER NOT NULL, recipient_id TEXT NOT NULL REFERENCES oa_operators(id) ON DELETE CASCADE,
 day TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reminder','escalation')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','submitted','uncertain','rejected','skipped')),
 attempted_at TEXT, message_id TEXT, UNIQUE(task_id,task_version,recipient_id,day,kind)
);
