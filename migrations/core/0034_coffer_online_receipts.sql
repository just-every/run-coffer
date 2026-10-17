-- Online gifts get their receipt email on their own unless the owner chooses review first.
ALTER TABLE cf_settings ADD COLUMN online_receipts TEXT NOT NULL DEFAULT 'automatic' CHECK(online_receipts IN ('automatic','review'));
