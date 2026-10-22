ALTER TABLE cf_ack_batches ADD COLUMN one_piece_per TEXT;
ALTER TABLE cf_ack_batches ADD COLUMN postage_per_piece_cents INTEGER;
CREATE TABLE cf_ack_mail_pieces(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES cf_ack_batches(id),position INTEGER NOT NULL,recipient_name TEXT NOT NULL,address TEXT,household_id TEXT,household_version INTEGER,members TEXT NOT NULL,letter_ids TEXT NOT NULL,content TEXT NOT NULL,snapshot TEXT NOT NULL,merge_blanks TEXT NOT NULL);
