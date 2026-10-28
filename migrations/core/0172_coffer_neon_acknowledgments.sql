DROP TRIGGER cf_soft_credit_ack_erase;
-- Preserve all existing rows and their exact native evidence. No table refers
-- to this table, so copying before replacing it does not require disabling FKs.
CREATE TABLE cf_soft_credit_acknowledgments_neon (
 soft_credit_id TEXT PRIMARY KEY REFERENCES cf_soft_credits(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version > 0),
 status TEXT NOT NULL CHECK(status IN ('acknowledged','not acknowledged','do not acknowledge')),
 acknowledged_on TEXT,
 method TEXT CHECK(method IN ('email','letter','phone call','in person','handwritten note','other')),
 interaction_id TEXT REFERENCES cf_interactions(id) ON DELETE CASCADE,
 note_id TEXT REFERENCES cf_donor_notes(id) ON DELETE CASCADE,
 reason TEXT,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'Coffer' CHECK(source IN ('Coffer','Little Green Light','Bloomerang','Raiser''s Edge NXT','Spreadsheet','Neon CRM')),
 source_reference TEXT,
 -- Only reviewed incumbent history may lack its historical date or evidence.
 -- Native writes retain the complete original constraint and server validation.
 CHECK(source<>'Coffer' OR
  (status='acknowledged' AND acknowledged_on IS NOT NULL AND method IS NOT NULL AND reason IS NULL
   AND ((interaction_id IS NOT NULL AND note_id IS NULL) OR (interaction_id IS NULL AND note_id IS NOT NULL)))
  OR (status='not acknowledged' AND acknowledged_on IS NULL AND method IS NULL AND interaction_id IS NULL AND note_id IS NULL AND reason IS NULL)
  OR (status='do not acknowledge' AND acknowledged_on IS NULL AND method IS NULL AND interaction_id IS NULL AND note_id IS NULL AND reason IS NOT NULL AND length(trim(reason))>0))
);
INSERT INTO cf_soft_credit_acknowledgments_neon SELECT * FROM cf_soft_credit_acknowledgments;
DROP TABLE cf_soft_credit_acknowledgments;
ALTER TABLE cf_soft_credit_acknowledgments_neon RENAME TO cf_soft_credit_acknowledgments;

-- Existing donor erasure removes the affected soft credits and their status
-- rows. Scrub source references before the interaction and credit cascades.
CREATE TRIGGER cf_soft_credit_ack_erase BEFORE UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_soft_credit_acknowledgments SET source_reference=NULL
 WHERE soft_credit_id IN (SELECT id FROM cf_soft_credits WHERE donor_id=NEW.id OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id));
END;
