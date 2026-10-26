-- Human-triggered drafting only. No report is automatically sent.
INSERT INTO cf_automation_grants(id,name,enabled,commands,daily_limit)
VALUES('development_reports','Monthly development report drafting',0,'["developmentReport.draft"]',12);
CREATE TABLE cf_development_reports (
 id TEXT PRIMARY KEY,month TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','sending','submitted','uncertain','rejected','held','partial')),
 subject TEXT NOT NULL,introduction TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '{}',
 sources TEXT NOT NULL CHECK(json_valid(sources)),recipients TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(recipients)),content_hash TEXT NOT NULL,
 grant_version INTEGER NOT NULL,control_version INTEGER NOT NULL,
 prepared_by TEXT NOT NULL,requested_by TEXT NOT NULL,prepared_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 approved_by TEXT,approver_version INTEGER,approved_at TEXT,approved_version INTEGER,
 custody_hold TEXT
);
CREATE TABLE cf_development_report_approvals (
 id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES cf_development_reports(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,content_hash TEXT NOT NULL,recipients TEXT NOT NULL,
 approved_by TEXT NOT NULL,approver_version INTEGER NOT NULL,authority_note TEXT NOT NULL,approved_at TEXT NOT NULL,
 UNIQUE(report_id,version)
);
CREATE TABLE cf_development_report_deliveries (
 id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES cf_development_reports(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('sending','submitted','uncertain','rejected','held')),
 attempted_at TEXT NOT NULL,message_id TEXT,detail TEXT,
 UNIQUE(report_id,recipient)
);
CREATE TABLE cf_development_report_donors (
 report_id TEXT NOT NULL REFERENCES cf_development_reports(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),PRIMARY KEY(report_id,donor_id)
);
CREATE INDEX cf_development_reports_month ON cf_development_reports(month,prepared_at);
-- A monotonic audit fence detects source changes while independent report
-- readers run. Deleting audit history cannot reuse an earlier fence value.
CREATE TABLE cf_development_report_clock(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
INSERT INTO cf_development_report_clock VALUES(1,1);
CREATE TRIGGER cf_development_report_clock_insert AFTER INSERT ON cf_events BEGIN UPDATE cf_development_report_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_development_report_clock_update AFTER UPDATE ON cf_events BEGIN UPDATE cf_development_report_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_development_report_clock_delete AFTER DELETE ON cf_events BEGIN UPDATE cf_development_report_clock SET revision=revision+1 WHERE id=1; END;
CREATE TABLE cf_development_report_schedule (
 id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 day_of_month INTEGER NOT NULL DEFAULT 1 CHECK(day_of_month BETWEEN 1 AND 28),
 approved_by TEXT,approver_version INTEGER,approved_at TEXT,hold_reason TEXT
);
INSERT INTO cf_development_report_schedule(id) VALUES(1);
CREATE TABLE cf_development_report_schedule_runs (
 month TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES cf_development_reports(id) ON DELETE CASCADE,
 schedule_version INTEGER NOT NULL,prepared_at TEXT NOT NULL
);
