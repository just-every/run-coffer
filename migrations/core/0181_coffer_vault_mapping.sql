-- Reviewed references are evidence only. They never authorize provider activity.
CREATE TABLE cf_vault_reviews (
 id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL UNIQUE,
 source TEXT NOT NULL,
 source_account TEXT NOT NULL,
 destination_account TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reviewed','saved','invalidated','removed','erased')),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 saved_at TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE cf_vault_rows (
 id TEXT PRIMARY KEY,
 review_id TEXT NOT NULL REFERENCES cf_vault_reviews(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 donor_version INTEGER NOT NULL,
 source_identity_hash TEXT NOT NULL,
 source_plan_id TEXT NOT NULL,
 payload TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('matched','missing','conflicting','unsupported')),
 reason TEXT NOT NULL,
 UNIQUE(review_id,position)
);
CREATE INDEX cf_vault_rows_donor ON cf_vault_rows(donor_id);
CREATE TABLE cf_vault_erased_sources (identity_hash TEXT PRIMARY KEY);
-- Minimal hashed identity custody survives removal of the uploaded evidence.
CREATE TABLE cf_vault_identities (
 identity_hash TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE
);
-- Erasure clears the entire multi-person file, including references in other
-- rows. Tombstones prevent the same erased source identity being reassigned.
CREATE TRIGGER cf_vault_erasure BEFORE UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO cf_vault_erased_sources SELECT identity_hash FROM cf_vault_identities WHERE donor_id=NEW.id;
 DELETE FROM cf_vault_identities WHERE donor_id=NEW.id;
 UPDATE cf_vault_reviews SET state='erased',version=version+1,source='',source_account='',destination_account=''
 WHERE id IN (SELECT review_id FROM cf_vault_rows WHERE donor_id=NEW.id);
 DELETE FROM cf_vault_rows WHERE review_id IN (SELECT id FROM cf_vault_reviews WHERE state='erased');
END;
-- A changed identity cannot retain the original review's authority.
CREATE TRIGGER cf_vault_identity_changed AFTER UPDATE OF donor_id ON cf_vault_rows
WHEN OLD.donor_id<>NEW.donor_id
BEGIN
 UPDATE cf_vault_reviews SET state='invalidated',version=version+1 WHERE id=NEW.review_id AND state IN ('reviewed','saved');
END;
