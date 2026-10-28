-- Bounded rows keep source identity out of the job's single JSON value.
CREATE TABLE cf_move_in_source_records (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, external_id TEXT NOT NULL, donor_external_id TEXT NOT NULL,
 source_key TEXT NOT NULL, donor_key TEXT NOT NULL, source_object TEXT,
 donor_id TEXT,
 PRIMARY KEY(job_id,kind,external_id)
);
CREATE INDEX cf_move_in_source_donor ON cf_move_in_source_records(donor_id);
CREATE TRIGGER cf_source_review_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_move_in_jobs SET report='{}',accepted_reason=NULL,redacted=1,check_report=NULL
 WHERE id IN(SELECT job_id FROM cf_move_in_source_records WHERE donor_id=NEW.id
  UNION SELECT job_id FROM cf_move_in_records WHERE donor_id=NEW.id OR related_id=NEW.id
  UNION SELECT i.job_id FROM cf_move_in_source_records i JOIN cf_move_in_jobs j ON j.id=i.job_id
   JOIN cf_move_in_records r ON r.source=j.source AND r.kind='donor' AND r.source_key=i.donor_key
   WHERE r.donor_id=NEW.id OR r.native_id=NEW.id);
 DELETE FROM cf_move_in_parts WHERE job_id IN(SELECT id FROM cf_move_in_jobs WHERE redacted=1);
 DELETE FROM cf_move_in_issues WHERE job_id IN(SELECT id FROM cf_move_in_jobs WHERE redacted=1);
 DELETE FROM cf_move_in_source_records WHERE job_id IN(SELECT id FROM cf_move_in_jobs WHERE redacted=1);
END;
-- Native merges retain immutable importer custody; this lookup follows its current constituent.
CREATE TRIGGER cf_source_review_merge AFTER INSERT ON cf_donor_merges
BEGIN
 UPDATE cf_move_in_source_records SET donor_id=NEW.into_id
 WHERE donor_id=NEW.donor_id OR EXISTS(
  SELECT 1 FROM cf_move_in_jobs j JOIN cf_move_in_records r ON r.source=j.source AND r.kind='donor'
  WHERE j.id=cf_move_in_source_records.job_id AND r.source_key=cf_move_in_source_records.donor_key AND r.donor_id=NEW.donor_id);
END;
CREATE TRIGGER cf_source_review_remerge AFTER UPDATE OF into_id ON cf_donor_merges
BEGIN
 UPDATE cf_move_in_source_records SET donor_id=NEW.into_id WHERE EXISTS(
  SELECT 1 FROM cf_move_in_jobs j JOIN cf_move_in_records r ON r.source=j.source AND r.kind='donor'
  WHERE j.id=cf_move_in_source_records.job_id AND r.source_key=cf_move_in_source_records.donor_key AND r.donor_id=NEW.donor_id);
END;
CREATE TRIGGER cf_source_review_merge_undo AFTER DELETE ON cf_donor_merges
BEGIN
 UPDATE cf_move_in_source_records SET donor_id=OLD.donor_id WHERE EXISTS(
  SELECT 1 FROM cf_move_in_jobs j JOIN cf_move_in_records r ON r.source=j.source AND r.kind='donor'
  WHERE j.id=cf_move_in_source_records.job_id AND r.source_key=cf_move_in_source_records.donor_key AND r.donor_id=OLD.donor_id);
END;
