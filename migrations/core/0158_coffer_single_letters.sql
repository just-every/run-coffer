CREATE TABLE cf_single_letters (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('prepared','approved','erased')),
 recipient_name TEXT NOT NULL, address TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, merge_blanks TEXT NOT NULL,
 template_kind TEXT NOT NULL, template_id TEXT, template_version INTEGER NOT NULL,
 gift_id TEXT REFERENCES cf_gifts(id), in_kind_id TEXT REFERENCES cf_in_kind_gifts(id),
 statement_year INTEGER, context_snapshot TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 prepared_at TEXT NOT NULL, prepared_by TEXT NOT NULL,
 approved_at TEXT, approved_by TEXT
);
CREATE INDEX cf_single_letter_donor ON cf_single_letters(donor_id,prepared_at);
CREATE TRIGGER cf_single_letter_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 UPDATE cf_single_letters SET version=version+1,status='erased',recipient_name='Erased donor',address='{}',subject='',body='',merge_blanks='[]',context_snapshot='{}',content_hash=''
 WHERE donor_id=NEW.id OR json_extract(address,'$.attentionDonorId')=NEW.id;
END;
