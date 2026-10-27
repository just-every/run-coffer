-- Credentials and pending OAuth states are installation-local. Financial claims
-- travel with archives so restoring a backup cannot send a deposit twice.
CREATE TABLE cf_qbo_connection (
 id INTEGER PRIMARY KEY CHECK(id=1), realm_id TEXT NOT NULL, sandbox INTEGER NOT NULL,
 client_id TEXT NOT NULL, sealed TEXT NOT NULL, expires_at TEXT NOT NULL, version INTEGER NOT NULL,
 connected_at TEXT NOT NULL
);
CREATE TABLE cf_qbo_oauth (
 state_hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE cf_qbo_mapping (
 id INTEGER PRIMARY KEY CHECK(id=1), realm_id TEXT NOT NULL, sandbox INTEGER NOT NULL,
 version INTEGER NOT NULL, mapping TEXT NOT NULL CHECK(json_valid(mapping)), updated_at TEXT NOT NULL
);
CREATE TABLE cf_qbo_postings (
 kind TEXT NOT NULL CHECK(kind IN ('payout','batch','adjustment')), source_id TEXT NOT NULL,
 realm_id TEXT NOT NULL, sandbox INTEGER NOT NULL, client_id TEXT NOT NULL, entity TEXT NOT NULL,
 request_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload)),
 state TEXT NOT NULL CHECK(state IN ('ready','sending','failed','uncertain','posted')),
 external_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, posted_at TEXT,
 PRIMARY KEY(kind,source_id)
);
CREATE TRIGGER cf_qbo_posting_frozen BEFORE UPDATE ON cf_qbo_postings
WHEN OLD.payload<>NEW.payload OR OLD.request_id<>NEW.request_id OR OLD.realm_id<>NEW.realm_id
 OR OLD.sandbox<>NEW.sandbox OR OLD.client_id<>NEW.client_id OR OLD.entity<>NEW.entity OR (OLD.state='posted' AND NEW.state<>'posted')
BEGIN SELECT RAISE(ABORT,'COFFER_QBO_POSTING_FROZEN'); END;
CREATE TRIGGER cf_qbo_payout_frozen BEFORE INSERT ON cf_payout_entries
WHEN EXISTS(SELECT 1 FROM cf_qbo_postings WHERE kind='payout' AND source_id=NEW.payout_id)
BEGIN SELECT RAISE(ABORT,'COFFER_POSTED_PAYOUT_FROZEN'); END;
