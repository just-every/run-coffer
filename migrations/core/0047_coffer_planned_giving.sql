CREATE TABLE cf_planned_gifts (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 version INTEGER NOT NULL DEFAULT 1,
 label TEXT NOT NULL,
 vehicle TEXT NOT NULL,
 estimated_cents INTEGER CHECK(estimated_cents IS NULL OR (typeof(estimated_cents)='integer' AND estimated_cents>=0)),
 documentation TEXT NOT NULL CHECK(documentation IN ('not requested','requested','received','reviewed')),
 recorded_on TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX cf_planned_gift_donor ON cf_planned_gifts(donor_id);
CREATE TABLE cf_planned_distributions (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id),
 intention_id TEXT NOT NULL REFERENCES cf_planned_gifts(id) ON DELETE CASCADE,
 linked_at TEXT NOT NULL
);
-- Separate enrollment periods preserve both histories through donor merge/undo.
CREATE TABLE cf_legacy_memberships (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 joined_on TEXT NOT NULL,
 ended_on TEXT
);
CREATE TRIGGER cf_planned_giving_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_planned_gifts WHERE donor_id=NEW.id;
 DELETE FROM cf_legacy_memberships WHERE donor_id=NEW.id;
END;
