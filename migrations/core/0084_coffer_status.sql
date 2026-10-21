-- DONOR-012: who recorded a status, why, the date of death, and the people told.
ALTER TABLE cf_donors ADD COLUMN status_reason TEXT;
ALTER TABLE cf_donors ADD COLUMN deceased_on TEXT;
ALTER TABLE cf_donors ADD COLUMN status_changed_at TEXT;
ALTER TABLE cf_donors ADD COLUMN status_changed_by TEXT;
ALTER TABLE cf_call_tasks ADD COLUMN closed_reason TEXT;
-- A recomputed household name for a survivor waits here until a person confirms it.
ALTER TABLE cf_households ADD COLUMN survivor_review INTEGER NOT NULL DEFAULT 0 CHECK(survivor_review IN (0,1));
CREATE TABLE cf_status_notices (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('inactive','deceased')),
 detail TEXT NOT NULL,
 created_at TEXT NOT NULL,
 acknowledged_at TEXT,
 acknowledged_by TEXT
);
CREATE INDEX cf_status_notices_owner ON cf_status_notices(owner_id,acknowledged_at);
CREATE TRIGGER cf_status_notice_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL AND OLD.erased_at IS NULL
BEGIN
 DELETE FROM cf_status_notices WHERE donor_id=NEW.id;
END;
