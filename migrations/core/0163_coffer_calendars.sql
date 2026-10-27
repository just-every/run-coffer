ALTER TABLE cf_donor_meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE cf_donor_meetings ADD COLUMN source_ref TEXT;
ALTER TABLE cf_donor_meetings ADD COLUMN source_operator_id TEXT;
CREATE UNIQUE INDEX cf_meeting_source ON cf_donor_meetings(source,source_operator_id,source_ref);

-- Transient authorization and booking capabilities never leave this installation.
CREATE TABLE cf_calendar_oauth (
 operator_id TEXT PRIMARY KEY,
 operator_version INTEGER NOT NULL,
 state_hash TEXT NOT NULL UNIQUE,
 app_sealed TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE cf_meeting_links (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL,
 operator_version INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 sealed_token TEXT NOT NULL,
 connection_sealed TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 created_at TEXT NOT NULL
);
CREATE TRIGGER cf_meeting_link_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_meeting_links WHERE donor_id=NEW.id; END;
