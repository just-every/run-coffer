-- Inventory membership also includes source records reused from earlier imports.
CREATE TABLE cf_move_in_inventory_refs (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('donor','pledge')),
 source_key TEXT NOT NULL,
 native_id TEXT,
 PRIMARY KEY(job_id,kind,source_key)
);
CREATE TRIGGER cf_move_in_inventory_refs_erased AFTER UPDATE OF redacted ON cf_move_in_jobs
WHEN NEW.redacted=1
BEGIN
 DELETE FROM cf_move_in_inventory_refs WHERE job_id=NEW.id;
END;
