-- Pool membership alone is not exact-number A2P registration evidence.
ALTER TABLE cf_sms_registration ADD COLUMN number_campaign_sid TEXT;
ALTER TABLE cf_sms_registration ADD COLUMN phone_number_sid TEXT;
ALTER TABLE cf_sms_registration ADD COLUMN number_configured_at TEXT;
ALTER TABLE cf_sms_registration ADD COLUMN number_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE cf_sms_registration ADD COLUMN number_status_at TEXT;
ALTER TABLE cf_sms_registration ADD COLUMN number_event_id TEXT;
UPDATE cf_sms_registration SET approved=0,version=version+1;
