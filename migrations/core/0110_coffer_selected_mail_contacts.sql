ALTER TABLE cf_ncoa_runs ADD COLUMN address_type TEXT NOT NULL DEFAULT '';
ALTER TABLE cf_ncoa_members ADD COLUMN contact_id TEXT;
ALTER TABLE cf_ncoa_members ADD COLUMN contact_version INTEGER;
ALTER TABLE cf_mail_address_snapshots ADD COLUMN contact_id TEXT;
ALTER TABLE cf_mail_address_snapshots ADD COLUMN contact_version INTEGER;
