-- Preserve the current sender while admitting Constant Contact.
CREATE TABLE cf_email_connection_next (
 id INTEGER PRIMARY KEY CHECK(id=1),
 provider TEXT NOT NULL CHECK(provider IN ('mango','mailchimp','constant-contact')),
 origin TEXT, credential TEXT NOT NULL, list_id TEXT, list_name TEXT,
 from_name TEXT, from_email TEXT, checked_at TEXT, check_note TEXT,
 saved_at TEXT NOT NULL, saved_by TEXT NOT NULL,
 merge_selection TEXT NOT NULL DEFAULT '[]', merge_version INTEGER NOT NULL DEFAULT 1,
 sender_email TEXT, tracking_evidence TEXT
);
INSERT INTO cf_email_connection_next(id,provider,origin,credential,list_id,list_name,from_name,from_email,checked_at,check_note,saved_at,saved_by,merge_selection,merge_version)
 SELECT id,provider,origin,credential,list_id,list_name,from_name,from_email,checked_at,check_note,saved_at,saved_by,merge_selection,merge_version FROM cf_email_connection;
DROP TABLE cf_email_connection;
ALTER TABLE cf_email_connection_next RENAME TO cf_email_connection;
