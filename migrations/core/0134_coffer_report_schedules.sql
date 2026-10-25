CREATE TABLE cf_report_schedules (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,report_path TEXT NOT NULL,recipients TEXT NOT NULL,
 cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly')),anchor_day INTEGER NOT NULL,
 next_at TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,
 approved_by TEXT NOT NULL,approver_version INTEGER NOT NULL,approved_at TEXT NOT NULL
);
CREATE INDEX cf_report_schedules_due ON cf_report_schedules(enabled,next_at);
CREATE TABLE cf_report_runs (
 id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES cf_report_schedules(id),
 due_at TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,
 attempted_at TEXT NOT NULL,message_id TEXT,detail TEXT,
 UNIQUE(schedule_id,due_at,recipient)
);
