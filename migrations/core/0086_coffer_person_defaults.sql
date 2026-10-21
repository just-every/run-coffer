-- DONOR-014: defaults are installation settings, never changes to prepared documents.
ALTER TABLE cf_settings ADD COLUMN name_defaults TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(name_defaults) AND json_type(name_defaults)='object');
ALTER TABLE cf_appeal_recipients ADD COLUMN name_fields TEXT CHECK(name_fields IS NULL OR json_valid(name_fields));
ALTER TABLE cf_communications ADD COLUMN name_fields TEXT CHECK(name_fields IS NULL OR json_valid(name_fields));
-- Existing DATA-001 / DONOR-002 custody applies to the new addressing snapshots.
CREATE TRIGGER cf_name_contact_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL AND OLD.erased_at IS NULL
BEGIN
 UPDATE cf_appeal_recipients SET name_fields=NULL WHERE json_extract(name_fields,'$._attention')=NEW.id;
 UPDATE cf_communications SET name_fields=NULL,subject='[erased]',body='[erased]' WHERE json_extract(name_fields,'$._attention')=NEW.id;
 UPDATE cf_donor_merge_journal SET status='erased',erased_at=NEW.erased_at WHERE id IN
 (SELECT merge_id FROM cf_donor_merge_rows WHERE table_name IN ('cf_appeal_recipients','cf_communications') AND json_extract(json_extract(value,'$.name_fields'),'$._attention')=NEW.id);
 DELETE FROM cf_donor_merge_rows WHERE merge_id IN (SELECT id FROM cf_donor_merge_journal WHERE status='erased');
END;

-- An atomic revision fences a preview without binding a potentially multi-megabyte donor snapshot.
-- This is transient concurrency state, excluded from portable product data.
CREATE TABLE cf_person_name_clock(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO cf_person_name_clock VALUES(1,0);
CREATE TRIGGER cf_names_cf_donors_insert AFTER INSERT ON cf_donors BEGIN
 UPDATE cf_person_name_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER cf_names_cf_donors_update AFTER UPDATE ON cf_donors BEGIN
 UPDATE cf_person_name_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER cf_names_cf_donors_delete AFTER DELETE ON cf_donors BEGIN
 UPDATE cf_person_name_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER cf_names_cf_donor_merges_insert AFTER INSERT ON cf_donor_merges BEGIN
 UPDATE cf_person_name_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER cf_names_cf_donor_merges_update AFTER UPDATE ON cf_donor_merges BEGIN
 UPDATE cf_person_name_clock SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER cf_names_cf_donor_merges_delete AFTER DELETE ON cf_donor_merges BEGIN
 UPDATE cf_person_name_clock SET revision=revision+1 WHERE id=1;
END;
