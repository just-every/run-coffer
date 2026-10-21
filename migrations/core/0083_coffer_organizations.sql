ALTER TABLE cf_donors ADD COLUMN organization_type TEXT;
ALTER TABLE cf_donors ADD COLUMN website TEXT;
ALTER TABLE cf_donors ADD COLUMN ein TEXT;
ALTER TABLE cf_donors ADD COLUMN informal_salutation TEXT;
CREATE TABLE cf_organization_contacts (
 id TEXT PRIMARY KEY,
 organization_donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 contact_donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 role TEXT NOT NULL,
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
 UNIQUE(organization_donor_id,contact_donor_id),
 CHECK(organization_donor_id<>contact_donor_id)
);
CREATE UNIQUE INDEX cf_organization_primary ON cf_organization_contacts(organization_donor_id) WHERE is_primary=1;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN recipient_address TEXT;
CREATE TRIGGER cf_organization_contact_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL AND OLD.erased_at IS NULL
BEGIN
 UPDATE cf_acks SET recipient_name='[erased contact]',address=NULL,subject='[erased]',body='[erased]',delivery_note=NULL
 WHERE json_extract(address,'$.attentionDonorId')=NEW.id;
 UPDATE cf_in_kind_acknowledgments SET recipient_address=NULL,subject='[erased]',body='[erased]' WHERE json_extract(recipient_address,'$.attentionDonorId')=NEW.id;
 UPDATE cf_donor_merge_journal SET status='erased',erased_at=NEW.erased_at WHERE id IN (SELECT merge_id FROM cf_donor_merge_rows WHERE (table_name='cf_acks' AND json_extract(value,'$.address.attentionDonorId')=NEW.id) OR (table_name='cf_acks' AND json_extract(json_extract(value,'$.address'),'$.attentionDonorId')=NEW.id) OR (table_name='cf_organization_contacts' AND (json_extract(value,'$.contact_donor_id')=NEW.id OR json_extract(value,'$.organization_donor_id')=NEW.id)));
 DELETE FROM cf_donor_merge_rows WHERE merge_id IN (SELECT id FROM cf_donor_merge_journal WHERE status='erased');
 DELETE FROM cf_organization_contacts WHERE organization_donor_id=NEW.id OR contact_donor_id=NEW.id;
END;
