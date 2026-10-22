-- Frozen appeal wording inherits the existing named-contact custody.
DROP TRIGGER cf_name_contact_erasure;
CREATE TRIGGER cf_name_contact_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL AND OLD.erased_at IS NULL
BEGIN
 UPDATE cf_appeal_recipients SET merge_fields=NULL,merge_blanks=NULL,rendered_subject=NULL,rendered_body=NULL WHERE json_extract(name_fields,'$._attention')=NEW.id;
 UPDATE cf_appeal_recipients SET name_fields=NULL WHERE json_extract(name_fields,'$._attention')=NEW.id;
 UPDATE cf_communications SET name_fields=NULL,subject='[erased]',body='[erased]' WHERE json_extract(name_fields,'$._attention')=NEW.id;
 UPDATE cf_donor_merge_journal SET status='erased',erased_at=NEW.erased_at WHERE id IN
 (SELECT merge_id FROM cf_donor_merge_rows WHERE table_name IN ('cf_appeal_recipients','cf_communications') AND json_extract(json_extract(value,'$.name_fields'),'$._attention')=NEW.id);
 DELETE FROM cf_donor_merge_rows WHERE merge_id IN (SELECT id FROM cf_donor_merge_journal WHERE status='erased');
END;

