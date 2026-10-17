-- A reviewed CRM move-in is applied in parts of about 1,000 records, so an
-- organization with tens of thousands of gifts moves in from the page alone.
PRAGMA defer_foreign_keys = on;
DROP TRIGGER cf_move_in_erasure;
CREATE TABLE cf_move_in_jobs_next (
 id TEXT PRIMARY KEY,
 file_fingerprint TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 source TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reviewed','applying','completed','undone')),
 report TEXT NOT NULL CHECK(json_valid(report)),
 accepted_reason TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 undone_at TEXT,
 redacted INTEGER NOT NULL DEFAULT 0,
 parts INTEGER NOT NULL DEFAULT 1,
 applied_parts INTEGER NOT NULL DEFAULT 0,
 acknowledged_before TEXT,
 checked_at TEXT,
 check_report TEXT
);
INSERT INTO cf_move_in_jobs_next(id,file_fingerprint,fingerprint,source,state,report,accepted_reason,created_at,created_by,undone_at,redacted,parts,applied_parts)
 SELECT id,file_fingerprint,fingerprint,source,state,report,accepted_reason,created_at,created_by,undone_at,redacted,1,CASE state WHEN 'completed' THEN 1 ELSE 0 END FROM cf_move_in_jobs;
DROP TABLE cf_move_in_jobs;
ALTER TABLE cf_move_in_jobs_next RENAME TO cf_move_in_jobs;
CREATE TABLE cf_move_in_parts (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 applied_at TEXT,
 PRIMARY KEY(job_id, position)
);
-- Gifts the old CRM already thanked: never shown as letters due or missing receipts.
CREATE TABLE cf_prior_acknowledgements (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL,
 acknowledged_before TEXT NOT NULL
);
CREATE INDEX cf_prior_ack_job ON cf_prior_acknowledgements(job_id);
CREATE TRIGGER cf_move_in_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_move_in_jobs SET report='{}',accepted_reason=NULL,redacted=1,check_report=NULL
 WHERE id IN (SELECT job_id FROM cf_move_in_records WHERE donor_id=NEW.id OR related_id=NEW.id);
 UPDATE cf_move_in_records SET snapshot=NULL WHERE donor_id=NEW.id OR related_id=NEW.id
  OR (kind='household' AND native_id=OLD.household_id);
 DELETE FROM cf_donor_notes WHERE donor_id=NEW.id;
END;
