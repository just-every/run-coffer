-- Retain the submitted destination even after a donor changes their email.
ALTER TABLE cf_communications ADD COLUMN recipient_email TEXT;
