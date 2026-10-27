-- Postal submissions retain identifiers only. Approved content and addressing
-- remain in the original frozen pieces; provider credentials never travel.
-- The opaque piece identity survives erasure of its personal mailing snapshot.
CREATE TABLE cf_postal_deliveries (
 id TEXT PRIMARY KEY,
 piece_id TEXT NOT NULL UNIQUE,
 batch_id TEXT NOT NULL REFERENCES cf_ack_batches(id),
 approved_hash TEXT NOT NULL,
 authorized_by TEXT NOT NULL,
 requested_at TEXT NOT NULL,
 provider_message_id TEXT UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('sending','submitted','uncertain','rejected')),
 submitted_at TEXT
);
CREATE TABLE cf_postal_documents (
 delivery_id TEXT NOT NULL REFERENCES cf_postal_deliveries(id),
 letter_id TEXT NOT NULL UNIQUE REFERENCES cf_acks(id),
 attempt_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(delivery_id,letter_id)
);
ALTER TABLE cf_letter_events ADD COLUMN provider TEXT NOT NULL DEFAULT 'SendGrid';
ALTER TABLE cf_letter_events ADD COLUMN provider_event TEXT;
ALTER TABLE cf_letter_events ADD COLUMN provider_message_id TEXT;
ALTER TABLE cf_letter_events ADD COLUMN provider_attempt_id TEXT;
ALTER TABLE cf_letter_events ADD COLUMN postal_piece_id TEXT;
UPDATE cf_letter_events SET provider_event=event,
 provider_attempt_id=(SELECT attempt_id FROM cf_acks WHERE id=cf_letter_events.letter_id);
