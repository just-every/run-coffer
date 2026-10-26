-- Installation signing material stays in the existing archive-excluded records.
ALTER TABLE cf_webhook_subscriptions ADD COLUMN previous_sealed_secret TEXT;
ALTER TABLE cf_webhook_subscriptions ADD COLUMN overlap_until TEXT;
ALTER TABLE cf_webhook_subscriptions ADD COLUMN key_generation INTEGER NOT NULL DEFAULT 1;
