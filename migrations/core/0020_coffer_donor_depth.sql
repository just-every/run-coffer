-- Directed links between existing donor records. A's employer is B; A is a
-- board member/foundation officer of B; A was introduced by B. Spouses are
-- symmetric and stored once, with the smaller donor id first.
CREATE TABLE cf_relationships (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 related_donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('spouse','employer','board_member','foundation_officer','introduced_by')),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 CHECK(donor_id <> related_donor_id),
 CHECK(type <> 'spouse' OR donor_id < related_donor_id),
 UNIQUE(donor_id,related_donor_id,type)
);
CREATE INDEX cf_relationship_related ON cf_relationships(related_donor_id,type);

CREATE TABLE cf_interactions (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('call','meeting','email')),
 occurred_on TEXT NOT NULL,
 who TEXT NOT NULL,
 notes TEXT NOT NULL,
 next_step TEXT,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE INDEX cf_interaction_donor ON cf_interactions(donor_id,occurred_on,recorded_at);

-- Native erasure marks the original donor before replacing it with an
-- anonymous ledger placeholder. Clear private content at that moment, even
-- when an erasure caller does not know about these newer tables.
CREATE TRIGGER cf_donor_depth_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_relationships WHERE donor_id=NEW.id OR related_donor_id=NEW.id;
 DELETE FROM cf_interactions WHERE donor_id=NEW.id;
END;
