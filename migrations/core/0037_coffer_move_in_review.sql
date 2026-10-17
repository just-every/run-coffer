-- Every row a CRM review names is kept with the review, so the page can list,
-- filter and download all of them, not only the first hundred.
CREATE TABLE cf_move_in_issues (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,
 severity TEXT NOT NULL CHECK(severity IN ('error','warning')),
 code TEXT NOT NULL,
 file TEXT,
 sheet TEXT,
 row INTEGER,
 column_name TEXT,
 message TEXT NOT NULL,
 PRIMARY KEY(job_id, position)
);
CREATE INDEX cf_move_in_issue_filter ON cf_move_in_issues(job_id, severity, code);
-- The gifts each move-in's files named, including gifts an earlier move-in already
-- brought, so its totals check compares the same gifts as the files.
CREATE TABLE cf_move_in_job_gifts (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id),
 gift_id TEXT NOT NULL,
 PRIMARY KEY(job_id, gift_id)
);
CREATE INDEX cf_move_in_job_gift ON cf_move_in_job_gifts(gift_id);
INSERT INTO cf_move_in_job_gifts(job_id, gift_id) SELECT job_id, native_id FROM cf_move_in_records WHERE kind='gift';
-- Erasing an imported donor also removes the review rows that could name them.
DROP TRIGGER cf_move_in_erasure;
CREATE TRIGGER cf_move_in_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_move_in_issues WHERE job_id IN (SELECT job_id FROM cf_move_in_records WHERE donor_id=NEW.id OR related_id=NEW.id);
 UPDATE cf_move_in_jobs SET report='{}',accepted_reason=NULL,redacted=1,check_report=NULL
 WHERE id IN (SELECT job_id FROM cf_move_in_records WHERE donor_id=NEW.id OR related_id=NEW.id);
 UPDATE cf_move_in_records SET snapshot=NULL WHERE donor_id=NEW.id OR related_id=NEW.id
  OR (kind='household' AND native_id=OLD.household_id);
 DELETE FROM cf_donor_notes WHERE donor_id=NEW.id;
END;
