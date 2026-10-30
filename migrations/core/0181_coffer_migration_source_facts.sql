-- Reviewed source facts are separate from native snapshots used for guarded undo.
CREATE TABLE cf_migration_source_records (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, source_key TEXT NOT NULL, native_id TEXT NOT NULL, donor_id TEXT, fact TEXT NOT NULL,
 PRIMARY KEY(job_id,kind,source_key)
);
-- Existing source custody redacts the whole import on donor erasure, including
-- reused constituents, merged identities and undone imports.
CREATE TRIGGER cf_migration_source_redaction AFTER UPDATE OF redacted ON cf_move_in_jobs
WHEN NEW.redacted=1
BEGIN DELETE FROM cf_migration_source_records WHERE job_id=NEW.id; END;
CREATE TRIGGER cf_migration_source_insert AFTER INSERT ON cf_migration_source_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_source_update AFTER UPDATE ON cf_migration_source_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER cf_migration_source_delete AFTER DELETE ON cf_migration_source_records
BEGIN UPDATE cf_migration_analysis_clock SET version=version+1 WHERE id=1; END;
