CREATE TABLE cf_saved_reports (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE cf_report_shares (
 report_id TEXT NOT NULL REFERENCES cf_saved_reports(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL,
 report_version INTEGER NOT NULL,
 approved_by TEXT NOT NULL,
 approver_version INTEGER NOT NULL,
 approved_at TEXT NOT NULL,
 PRIMARY KEY(report_id,operator_id)
);
