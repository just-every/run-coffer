-- Source campaign and appeal labels remain separate from native configuration.
CREATE TABLE cf_import_gift_designations (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 campaign TEXT NOT NULL,
 appeal TEXT NOT NULL
);
CREATE TRIGGER cf_import_designation_erase BEFORE UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_import_gift_designations WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
END;
