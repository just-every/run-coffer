ALTER TABLE cf_settings ADD COLUMN offline_receipts INTEGER NOT NULL DEFAULT 0 CHECK(offline_receipts IN (0,1));
ALTER TABLE cf_settings ADD COLUMN receipt_authorizer_id TEXT;
ALTER TABLE cf_settings ADD COLUMN receipt_authorizer_version INTEGER;
ALTER TABLE cf_acks ADD COLUMN receipt_organisation TEXT;

-- A gift and its queue entry commit together. A claimed attempt never requeues.
CREATE TABLE cf_automatic_receipts (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source IN ('online','offline')),
 settings_version INTEGER NOT NULL,
 template_revision INTEGER NOT NULL,
 gift_version INTEGER NOT NULL,
 donor_version INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','complete','held')),
 note TEXT,
 created_at TEXT NOT NULL,
 attempted_at TEXT,
 attempt_id TEXT
);
CREATE INDEX cf_automatic_receipts_pending ON cf_automatic_receipts(state,created_at);
