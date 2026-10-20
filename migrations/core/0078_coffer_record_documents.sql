CREATE TABLE cf_record_documents (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 gift_id TEXT REFERENCES cf_gifts(id) ON DELETE CASCADE, pledge_id TEXT REFERENCES cf_pledges(id) ON DELETE CASCADE, prospect_id TEXT REFERENCES cf_prospects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, file_name TEXT NOT NULL, media_type TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, byte_length INTEGER NOT NULL CHECK(byte_length>0),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 CHECK((gift_id IS NOT NULL)+(pledge_id IS NOT NULL)+(prospect_id IS NOT NULL)<=1)
);
CREATE INDEX cf_record_documents_donor ON cf_record_documents(donor_id);
-- One owned object catalogue covers campaign media and private record files.
CREATE TABLE cf_file_objects (object_key TEXT PRIMARY KEY);
INSERT INTO cf_file_objects SELECT object_key FROM cf_campaign_media WHERE object_key IS NOT NULL;
CREATE TRIGGER cf_media_object_added AFTER INSERT ON cf_campaign_media WHEN NEW.object_key IS NOT NULL
BEGIN INSERT OR IGNORE INTO cf_file_objects VALUES(NEW.object_key); END;
CREATE TRIGGER cf_media_object_removed AFTER DELETE ON cf_campaign_media WHEN OLD.object_key IS NOT NULL
BEGIN DELETE FROM cf_file_objects WHERE object_key=OLD.object_key; END;
CREATE TRIGGER cf_media_object_changed AFTER UPDATE OF object_key ON cf_campaign_media
BEGIN DELETE FROM cf_file_objects WHERE object_key=OLD.object_key; INSERT OR IGNORE INTO cf_file_objects SELECT NEW.object_key WHERE NEW.object_key IS NOT NULL; END;
CREATE TRIGGER cf_document_object_added AFTER INSERT ON cf_record_documents
BEGIN INSERT OR IGNORE INTO cf_file_objects VALUES(NEW.object_key); END;
CREATE TRIGGER cf_document_object_removed AFTER DELETE ON cf_record_documents
BEGIN DELETE FROM cf_file_objects WHERE object_key=OLD.object_key; END;
-- Erasure records object cleanup in the same transaction as donor deletion.
CREATE TABLE cf_document_purges (object_key TEXT PRIMARY KEY);
CREATE TRIGGER cf_document_erasure BEFORE DELETE ON cf_donors
BEGIN INSERT OR IGNORE INTO cf_document_purges SELECT object_key FROM cf_record_documents WHERE donor_id=OLD.id; END;

CREATE TABLE cf_document_uploads (object_key TEXT PRIMARY KEY, started_at TEXT NOT NULL, discarded_at TEXT);

CREATE TRIGGER cf_document_early_erasure BEFORE DELETE ON cf_record_documents
WHEN EXISTS(SELECT 1 FROM cf_donors WHERE id=OLD.donor_id AND erased_at IS NOT NULL)
BEGIN INSERT OR IGNORE INTO cf_document_purges VALUES(OLD.object_key); END;
