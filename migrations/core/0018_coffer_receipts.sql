-- Sending and provider evidence belong to each frozen letter, independently of
-- the batch's preparation/approval/export lifecycle.
ALTER TABLE cf_ack_batches ADD COLUMN kind TEXT NOT NULL DEFAULT 'gift';
ALTER TABLE cf_ack_batches ADD COLUMN statement_year INTEGER;
ALTER TABLE cf_acks ADD COLUMN statement_gifts TEXT;
ALTER TABLE cf_acks ADD COLUMN route TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE cf_acks ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE cf_acks ADD COLUMN attempt_id TEXT;
ALTER TABLE cf_acks ADD COLUMN message_id TEXT;
ALTER TABLE cf_acks ADD COLUMN submitted_at TEXT;
ALTER TABLE cf_acks ADD COLUMN delivered_at TEXT;
ALTER TABLE cf_acks ADD COLUMN printed_at TEXT;
ALTER TABLE cf_acks ADD COLUMN delivery_note TEXT;
CREATE UNIQUE INDEX cf_ack_attempt ON cf_acks(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE TABLE cf_letter_events (
 id TEXT PRIMARY KEY,
 letter_id TEXT NOT NULL REFERENCES cf_acks(id),
 event TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE INDEX cf_letter_event_letter ON cf_letter_events(letter_id,occurred_at);
