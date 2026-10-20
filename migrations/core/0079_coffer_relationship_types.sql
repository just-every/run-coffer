-- DONOR-003: parent/child and advisor/client are directed; friends, like
-- spouses, have one canonical pair regardless of which record creates it.
DROP TRIGGER cf_donor_depth_erasure;

CREATE TABLE cf_relationships_expanded (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 related_donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('spouse','parent','friend','advisor','employer','board_member','foundation_officer','introduced_by')),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 CHECK(donor_id <> related_donor_id),
 CHECK(type NOT IN ('spouse','friend') OR donor_id < related_donor_id),
 UNIQUE(donor_id,related_donor_id,type)
);
INSERT INTO cf_relationships_expanded SELECT * FROM cf_relationships;
DROP TABLE cf_relationships;
ALTER TABLE cf_relationships_expanded RENAME TO cf_relationships;
CREATE INDEX cf_relationship_related ON cf_relationships(related_donor_id,type);

CREATE TRIGGER cf_donor_depth_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_relationships WHERE donor_id=NEW.id OR related_donor_id=NEW.id;
 DELETE FROM cf_interactions WHERE donor_id=NEW.id;
END;
