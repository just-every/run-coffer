-- CRM exports publish in one D1 transaction, independently of paged API imports.
CREATE TABLE cf_move_in_jobs (
 id TEXT PRIMARY KEY,
 file_fingerprint TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 source TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('completed','undone')),
 report TEXT NOT NULL CHECK(json_valid(report)),
 accepted_reason TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 undone_at TEXT,
 redacted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE cf_move_in_records (
 source TEXT NOT NULL,
 kind TEXT NOT NULL,
 source_key TEXT NOT NULL,
 native_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id),
 owned INTEGER NOT NULL CHECK(owned IN (0,1)),
 donor_id TEXT,
 related_id TEXT,
 snapshot TEXT,
 PRIMARY KEY(source,kind,source_key)
);
CREATE INDEX cf_move_in_record_job ON cf_move_in_records(job_id);
CREATE TABLE cf_donor_notes (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 occurred_on TEXT NOT NULL,
 body TEXT NOT NULL,
 source TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE TRIGGER cf_move_in_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_move_in_jobs SET report='{}',accepted_reason=NULL,redacted=1
 WHERE id IN (SELECT job_id FROM cf_move_in_records WHERE donor_id=NEW.id OR related_id=NEW.id);
 UPDATE cf_move_in_records SET snapshot=NULL WHERE donor_id=NEW.id OR related_id=NEW.id
  OR (kind='household' AND native_id=OLD.household_id);
 DELETE FROM cf_donor_notes WHERE donor_id=NEW.id;
END;
