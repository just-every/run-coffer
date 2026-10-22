ALTER TABLE cf_appeal_recipients ADD COLUMN email_contact_id TEXT;
ALTER TABLE cf_appeal_recipients ADD COLUMN email_contact_version INTEGER;
ALTER TABLE cf_communications ADD COLUMN recipient_contact_id TEXT;
ALTER TABLE cf_communications ADD COLUMN recipient_contact_version INTEGER;
