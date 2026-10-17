CREATE TABLE cf_appeal_messages (
 appeal_id TEXT PRIMARY KEY REFERENCES cf_appeals(id) ON DELETE CASCADE,
 subject TEXT NOT NULL, body TEXT NOT NULL
);
ALTER TABLE cf_appeal_recipients ADD COLUMN total_cents INTEGER;
ALTER TABLE cf_appeal_recipients ADD COLUMN gift_count INTEGER;
ALTER TABLE cf_appeal_recipients ADD COLUMN last_gift TEXT;
CREATE TABLE cf_communications (
 id TEXT PRIMARY KEY, message_key TEXT NOT NULL UNIQUE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('appeal','welcome')),
 source_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'mango',
 campaign_id TEXT, revision_id TEXT, status TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, reply_to TEXT NOT NULL,
 created_at TEXT NOT NULL, submitted_at TEXT, note TEXT,
 remote_status TEXT, checked_at TEXT
);
CREATE INDEX cf_communications_donor ON cf_communications(donor_id,created_at);
CREATE TABLE cf_preference_sync (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id) ON DELETE CASCADE,
 email TEXT NOT NULL, consent_id INTEGER, remote_status TEXT,
 state TEXT NOT NULL, checked_at TEXT NOT NULL, note TEXT
);
CREATE TABLE cf_welcome (
 id TEXT PRIMARY KEY CHECK(id='welcome'), published_at TEXT NOT NULL, published_by TEXT NOT NULL,
 thank_subject TEXT NOT NULL, thank_body TEXT NOT NULL,
 impact_subject TEXT NOT NULL, impact_body TEXT NOT NULL,
 ask_subject TEXT NOT NULL, ask_body TEXT NOT NULL,
 impact_days INTEGER NOT NULL, ask_days INTEGER NOT NULL
);
CREATE TABLE cf_welcome_enrollments (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id) ON DELETE CASCADE,
 first_gift_id TEXT NOT NULL, enrolled_at TEXT NOT NULL, status TEXT NOT NULL, stopped_at TEXT
);
CREATE TABLE cf_welcome_steps (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 step TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL,
 message_key TEXT NOT NULL UNIQUE, note TEXT
);
CREATE TABLE cf_reply_tasks (
 id TEXT PRIMARY KEY, communication_id TEXT REFERENCES cf_communications(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 owner_id TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
 received_at TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, note TEXT,
 forwarding_at TEXT, attempt_key TEXT, forwarded_to TEXT
);
CREATE TRIGGER cf_communications_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_reply_tasks WHERE donor_id=NEW.id;
 DELETE FROM cf_communications WHERE donor_id=NEW.id;
 DELETE FROM cf_preference_sync WHERE donor_id=NEW.id;
 DELETE FROM cf_welcome_steps WHERE donor_id=NEW.id;
 DELETE FROM cf_welcome_enrollments WHERE donor_id=NEW.id;
END;
