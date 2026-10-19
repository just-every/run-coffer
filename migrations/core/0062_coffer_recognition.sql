-- Recognition is separate from legal donor identity and immutable money facts.
-- Neither a historic gift nor an existing donor is opted into publication.
CREATE TABLE cf_donor_recognition (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id) ON DELETE CASCADE,
 anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1)),
 recognition_name TEXT,
 honor_roll_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(honor_roll_opt_in IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE cf_gift_recognition (
 gift_id TEXT PRIMARY KEY, -- Unified monetary or property original ID; validated below.
 anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1)),
 wall_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(wall_opt_in IN (0,1)),
 recognition_name TEXT
);
ALTER TABLE cf_giving_intents ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1));
ALTER TABLE cf_giving_intents ADD COLUMN wall_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(wall_opt_in IN (0,1));
ALTER TABLE cf_giving_intents ADD COLUMN recognition_name TEXT;

-- Native erasure marks the donor before it moves ledger ownership. Remove
-- names from both snapshots and unfinished checkouts at that first boundary.
CREATE TRIGGER cf_recognition_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_donor_recognition WHERE donor_id=NEW.id;
 UPDATE cf_gift_recognition SET anonymous=1,wall_opt_in=0,recognition_name=NULL
 WHERE gift_id IN (SELECT id FROM cf_contribution_ledger WHERE donor_id=NEW.id);
 UPDATE cf_giving_intents SET anonymous=1,wall_opt_in=0,recognition_name=NULL
 WHERE donor_id=NEW.id OR email=OLD.email;
END;

-- Also cover native reassignment directly to an erased ledger placeholder.
-- Ordinary merge and journal-driven undo retain the gift's original snapshot.
CREATE TRIGGER cf_gift_recognition_erasure AFTER UPDATE OF donor_id ON cf_gifts
WHEN NEW.donor_id IS NOT OLD.donor_id
 AND EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
BEGIN
 UPDATE cf_gift_recognition SET anonymous=1,wall_opt_in=0,recognition_name=NULL
 WHERE gift_id=NEW.id;
END;
CREATE TRIGGER cf_intent_recognition_erasure AFTER UPDATE OF donor_id ON cf_giving_intents
WHEN NEW.donor_id IS NOT OLD.donor_id
 AND EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
BEGIN
 UPDATE cf_giving_intents SET anonymous=1,wall_opt_in=0,recognition_name=NULL WHERE id=NEW.id;
END;

CREATE TRIGGER cf_recognition_gift_exists BEFORE INSERT ON cf_gift_recognition
WHEN NOT EXISTS(SELECT 1 FROM cf_contribution_ledger WHERE id=NEW.gift_id AND kind IN ('gift','in_kind'))
BEGIN SELECT RAISE(ABORT,'COFFER_RECOGNITION_GIFT'); END;
CREATE TRIGGER cf_recognition_cash_delete AFTER DELETE ON cf_gifts
BEGIN DELETE FROM cf_gift_recognition WHERE gift_id=OLD.id; END;
CREATE TRIGGER cf_recognition_property_delete AFTER DELETE ON cf_in_kind_gifts
BEGIN DELETE FROM cf_gift_recognition WHERE gift_id=OLD.id; END;
