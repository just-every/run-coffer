-- A claimed renewal notice is never automatically retried, including after restore.
CREATE TABLE cf_membership_notices (
 reminder_id TEXT PRIMARY KEY REFERENCES cf_membership_reminders(id) ON DELETE CASCADE,
 content_hash TEXT NOT NULL, claimed_at TEXT NOT NULL, actor_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','uncertain')),
 message_id TEXT
);
