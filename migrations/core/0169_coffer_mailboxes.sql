-- Personal authorization never leaves the installation; logged mail is portable.
CREATE TABLE cf_mailbox_oauth (
 operator_id TEXT NOT NULL, provider TEXT NOT NULL, operator_version INTEGER NOT NULL,
 state_hash TEXT NOT NULL UNIQUE, app_sealed TEXT NOT NULL, verifier TEXT NOT NULL, expires_at TEXT NOT NULL,
 PRIMARY KEY(operator_id,provider)
);
CREATE TABLE cf_mailbox_connections (
 operator_id TEXT NOT NULL, provider TEXT NOT NULL, operator_version INTEGER NOT NULL,
 account TEXT NOT NULL, grant_id TEXT NOT NULL UNIQUE, app_sealed TEXT NOT NULL, sealed TEXT NOT NULL, bcc_token TEXT NOT NULL UNIQUE,
 PRIMARY KEY(operator_id,provider)
);
CREATE TABLE cf_mailbox_messages (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL, provider TEXT NOT NULL, account_hash TEXT NOT NULL,
 direction TEXT NOT NULL, subject TEXT NOT NULL, excerpt TEXT NOT NULL, link TEXT,
 occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL,
 request_key TEXT UNIQUE, recipient TEXT, donor_version INTEGER, purpose TEXT,
 connection_sealed TEXT, note TEXT
);
CREATE INDEX cf_mailbox_donor ON cf_mailbox_messages(donor_id,occurred_at);
-- Hash-only tombstones prevent captured mail returning after erasure or replay.
CREATE TABLE cf_mailbox_seen (id TEXT PRIMARY KEY);
CREATE TABLE cf_mailbox_erased (address_hash TEXT PRIMARY KEY, erased_at TEXT NOT NULL);
ALTER TABLE cf_reply_tasks ADD COLUMN mailbox_id TEXT;
CREATE TRIGGER cf_mailbox_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_mailbox_messages WHERE donor_id=NEW.id; END;
