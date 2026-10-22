-- Connection custody is excluded from archives; restores share no extra fields.
ALTER TABLE cf_email_connection ADD COLUMN merge_selection TEXT NOT NULL DEFAULT '[]';
ALTER TABLE cf_email_connection ADD COLUMN merge_version INTEGER NOT NULL DEFAULT 1;
