-- Installation credentials stay out of portable donor archives.
CREATE TABLE cf_stewardship_setup (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL DEFAULT 1,
 encrypted_key TEXT,
 tested_at TEXT,
 updated_at TEXT NOT NULL
);
INSERT INTO cf_stewardship_setup(id,version,updated_at) VALUES(1,1,'');

CREATE TABLE cf_stewardship_drafts (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>0),
 kind TEXT NOT NULL CHECK(kind IN ('thank_you','impact')),
 status TEXT NOT NULL CHECK(status IN ('draft','discarded','sending','submitted','uncertain','rejected')),
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 sources TEXT NOT NULL CHECK(json_valid(sources)),
 source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
 citations TEXT NOT NULL CHECK(json_valid(citations)),
 reviewed_version INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 attempt_id TEXT,
 recipient_email TEXT,
 message_id TEXT,
 submitted_at TEXT
);
CREATE INDEX cf_stewardship_donor ON cf_stewardship_drafts(donor_id,created_at);

-- Keep previous edits, including the AI original, available to the reviewer.
CREATE TABLE cf_stewardship_versions (
 draft_id TEXT NOT NULL REFERENCES cf_stewardship_drafts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 edited_at TEXT NOT NULL,
 edited_by TEXT NOT NULL,
 PRIMARY KEY(draft_id,version)
);

-- The native erasure flow first marks the donor and then removes the record.
-- Redact drafts even if a tribute named this donor on somebody else's gift.
CREATE TRIGGER cf_stewardship_erasure BEFORE UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_stewardship_drafts WHERE donor_id=NEW.id OR EXISTS(
  SELECT 1 FROM json_each(cf_stewardship_drafts.sources) s
  JOIN cf_gift_tributes t ON json_extract(s.value,'$.id')='tribute:'||t.gift_id
  WHERE t.donor_id=NEW.id
 );
END;
