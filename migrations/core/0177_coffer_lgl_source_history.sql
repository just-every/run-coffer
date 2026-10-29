-- Source history is preserved separately from active memberships and delivery.
CREATE TABLE cf_crm_source_history (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 source_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('membership','mailing')),
 label TEXT NOT NULL,
 occurred_on TEXT NOT NULL,
 details TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 imported_at TEXT NOT NULL,
 imported_by TEXT NOT NULL
);
CREATE INDEX cf_crm_source_history_donor ON cf_crm_source_history(donor_id);
CREATE TABLE cf_move_in_job_history (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 history_id TEXT NOT NULL REFERENCES cf_crm_source_history(id) ON DELETE CASCADE,
 PRIMARY KEY(job_id,history_id)
);
