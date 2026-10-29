-- Only an explicitly reviewed existing tag can become a source assignment.
CREATE TABLE cf_move_in_tag_write(id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TABLE cf_move_in_tags (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 tag TEXT NOT NULL REFERENCES cf_tag_definitions(name),
 source TEXT NOT NULL,
 source_on TEXT,
 codes TEXT NOT NULL CHECK(json_valid(codes)),
 owns_assignment INTEGER NOT NULL CHECK(owns_assignment IN (0,1)),
 native_changed INTEGER NOT NULL DEFAULT 0 CHECK(native_changed IN (0,1)),
 imported_at TEXT NOT NULL,
 imported_by TEXT NOT NULL
);
CREATE INDEX cf_move_in_tags_donor ON cf_move_in_tags(donor_id,tag);
CREATE TABLE cf_move_in_job_tags (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 tag_id TEXT NOT NULL REFERENCES cf_move_in_tags(id) ON DELETE CASCADE,
 PRIMARY KEY(job_id,tag_id)
);
CREATE TRIGGER cf_move_in_tag_assign AFTER INSERT ON cf_move_in_tags
WHEN NEW.owns_assignment=1
BEGIN
 INSERT INTO cf_move_in_tag_write VALUES(1);
 INSERT OR IGNORE INTO cf_donor_tags(donor_id,tag,created_at,created_by)
 VALUES(NEW.donor_id,NEW.tag,NEW.imported_at,NEW.imported_by);
 DELETE FROM cf_move_in_tag_write;
END;
-- Ordinary native edits, including reaffirming an existing tag, take custody.
-- Trusted merge restoration uses its existing transaction-local ingest marker.
CREATE TRIGGER cf_move_in_tag_native_insert BEFORE INSERT ON cf_donor_tags
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NOT EXISTS(SELECT 1 FROM cf_move_in_tag_write)
BEGIN UPDATE cf_move_in_tags SET native_changed=1 WHERE donor_id=NEW.donor_id AND tag=NEW.tag; END;
CREATE TRIGGER cf_move_in_tag_native_update BEFORE UPDATE ON cf_donor_tags
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NOT EXISTS(SELECT 1 FROM cf_move_in_tag_write)
BEGIN UPDATE cf_move_in_tags SET native_changed=1 WHERE (donor_id=OLD.donor_id AND tag=OLD.tag) OR (donor_id=NEW.donor_id AND tag=NEW.tag); END;
CREATE TRIGGER cf_move_in_tag_native_delete BEFORE DELETE ON cf_donor_tags
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NOT EXISTS(SELECT 1 FROM cf_move_in_tag_write)
BEGIN UPDATE cf_move_in_tags SET native_changed=1 WHERE donor_id=OLD.donor_id AND tag=OLD.tag; END;
CREATE TRIGGER cf_move_in_tag_undo_guard BEFORE DELETE ON cf_move_in_tags
WHEN OLD.owns_assignment=1
 AND NOT EXISTS(SELECT 1 FROM cf_identity_ingest)
 AND EXISTS(SELECT 1 FROM cf_donors WHERE id=OLD.donor_id AND erased_at IS NULL)
 AND (OLD.native_changed=1
  OR NOT EXISTS(SELECT 1 FROM cf_donor_tags WHERE donor_id=OLD.donor_id AND tag=OLD.tag AND created_at=OLD.imported_at AND created_by=OLD.imported_by)
  OR EXISTS(SELECT 1 FROM cf_move_in_tags WHERE id<>OLD.id AND donor_id=OLD.donor_id AND tag=OLD.tag))
BEGIN SELECT RAISE(ABORT,'COFFER_TAG_CHANGED'); END;
CREATE TRIGGER cf_move_in_tag_unassign AFTER DELETE ON cf_move_in_tags
WHEN OLD.owns_assignment=1 AND NOT EXISTS(SELECT 1 FROM cf_identity_ingest)
BEGIN
 DELETE FROM cf_donor_tags WHERE donor_id=OLD.donor_id AND tag=OLD.tag
 AND created_at=OLD.imported_at AND created_by=OLD.imported_by;
END;
