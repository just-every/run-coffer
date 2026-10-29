-- Reviewed outcome membership is row-based, like the existing gift journal.
-- Keeping every source key in one report would exceed D1's per-value limit.
CREATE TABLE cf_move_in_outcome_refs (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('gift','softCredit')),
 source_key TEXT NOT NULL,
 PRIMARY KEY(job_id,kind,source_key)
);
CREATE TRIGGER cf_move_in_outcome_refs_erased AFTER UPDATE OF redacted ON cf_move_in_jobs
WHEN NEW.redacted=1
BEGIN
 DELETE FROM cf_move_in_outcome_refs WHERE job_id=NEW.id;
END;
