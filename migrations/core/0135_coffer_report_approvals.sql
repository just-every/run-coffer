CREATE TABLE cf_report_recipients (
 schedule_id TEXT NOT NULL REFERENCES cf_report_schedules(id),
 recipient TEXT NOT NULL,approved_by TEXT NOT NULL,approved_at TEXT NOT NULL,revoked_at TEXT,
 PRIMARY KEY(schedule_id,recipient)
);
-- Existing explicit approvals remain valid and individually revocable.
INSERT INTO cf_report_recipients(schedule_id,recipient,approved_by,approved_at)
 SELECT s.id,j.value,s.approved_by,s.approved_at FROM cf_report_schedules s,json_each(s.recipients) j;
CREATE TABLE cf_report_runs_next (
 id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES cf_report_schedules(id),
 due_at TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,
 attempted_at TEXT NOT NULL,message_id TEXT,detail TEXT,retry_of TEXT
);
INSERT INTO cf_report_runs_next(id,schedule_id,due_at,recipient,status,attempted_at,message_id,detail)
 SELECT id,schedule_id,due_at,recipient,status,attempted_at,message_id,detail FROM cf_report_runs;
DROP TABLE cf_report_runs;
ALTER TABLE cf_report_runs_next RENAME TO cf_report_runs;
CREATE UNIQUE INDEX cf_report_occurrence ON cf_report_runs(schedule_id,due_at,recipient) WHERE retry_of IS NULL;
CREATE UNIQUE INDEX cf_report_manual_retry ON cf_report_runs(retry_of) WHERE retry_of IS NOT NULL;
