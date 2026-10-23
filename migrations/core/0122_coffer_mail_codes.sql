-- Permanent, non-identifying bindings remain after an erased mailing piece is redacted.
ALTER TABLE cf_appeal_codes ADD COLUMN mail_appeal_id TEXT REFERENCES cf_appeals(id);
ALTER TABLE cf_appeal_codes ADD COLUMN mail_piece_id TEXT;
CREATE UNIQUE INDEX cf_mail_piece_code ON cf_appeal_codes(mail_piece_id) WHERE mail_piece_id IS NOT NULL;
ALTER TABLE cf_appeal_pieces ADD COLUMN response_code TEXT COLLATE NOCASE REFERENCES cf_appeal_codes(code);
ALTER TABLE cf_appeal_pieces ADD COLUMN ask_cents INTEGER CHECK(ask_cents IS NULL OR ask_cents>0);
ALTER TABLE cf_batch_entries ADD COLUMN appeal TEXT COLLATE NOCASE REFERENCES cf_appeal_codes(code);
CREATE TRIGGER cf_mail_code_immutable BEFORE UPDATE OF code,mail_appeal_id,mail_piece_id ON cf_appeal_codes
WHEN OLD.mail_appeal_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Mail response code bindings are permanent'); END;
