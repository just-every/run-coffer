-- DEV-006: scheduling metadata only; briefs read current, authorized sources.
CREATE TABLE cf_donor_meetings (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 starts_at TEXT NOT NULL,
 prepare_at TEXT NOT NULL,
 ready_at TEXT,
 cancelled_at TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE INDEX cf_meetings_due ON cf_donor_meetings(prepare_at) WHERE ready_at IS NULL AND cancelled_at IS NULL;
CREATE TRIGGER cf_meetings_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_donor_meetings WHERE donor_id=NEW.id;
END;
