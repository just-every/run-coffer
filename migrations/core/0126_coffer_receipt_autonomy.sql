-- Installation policy is private application data and travels with backups.
-- A null selected key preserves the existing prepare-for-review behavior.
CREATE TABLE cf_receipt_autonomy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL DEFAULT 1,
 acknowledge_from TEXT,
 max_standard_cents INTEGER NOT NULL DEFAULT 100000 CHECK(max_standard_cents>0),
 updated_at TEXT,
 updated_by TEXT
);
INSERT INTO cf_receipt_autonomy(id) VALUES(1);
-- Credential bindings stay with the installation, outside portable donor data.
ALTER TABLE cf_agent_grant_control ADD COLUMN receipt_key_id TEXT REFERENCES cf_agent_keys(id);
CREATE TABLE cf_receipt_reviews (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 reasons TEXT NOT NULL CHECK(json_valid(reasons)),
 batch_id TEXT REFERENCES cf_ack_batches(id),
 updated_at TEXT NOT NULL
);
