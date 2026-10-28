-- One branded form belongs to each campaign. All four tables are portable
-- product custody; no credentials or provider customer data are stored here.
CREATE TABLE cf_giving_forms (
 campaign_id TEXT PRIMARY KEY REFERENCES cf_campaigns(id),
 version INTEGER NOT NULL CHECK(version>0), configuration TEXT NOT NULL CHECK(json_valid(configuration)), updated_at TEXT NOT NULL
);
CREATE TABLE cf_giving_form_intents (
 intent_id TEXT PRIMARY KEY REFERENCES cf_giving_intents(id) ON DELETE CASCADE,
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id), form_version INTEGER NOT NULL CHECK(form_version>=0),
 fund TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);
CREATE TABLE cf_giving_form_gifts (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 intent_id TEXT NOT NULL REFERENCES cf_giving_intents(id), form_version INTEGER NOT NULL CHECK(form_version>=0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), recorded_at TEXT NOT NULL,
 values_applied INTEGER NOT NULL DEFAULT 0 CHECK(values_applied IN (0,1))
);
CREATE INDEX cf_giving_form_gift_intent ON cf_giving_form_gifts(intent_id);
-- Opaque checkout IDs fence copied captures after private answers are erased.
CREATE TABLE cf_giving_form_redactions (intent_id TEXT PRIMARY KEY);
CREATE TRIGGER cf_giving_form_capture_frozen BEFORE UPDATE ON cf_giving_form_intents
BEGIN SELECT RAISE(ABORT,'COFFER_FORM_CAPTURE_FROZEN'); END;
CREATE TRIGGER cf_giving_form_gift_frozen BEFORE UPDATE OF gift_id,intent_id,form_version,snapshot,recorded_at ON cf_giving_form_gifts
BEGIN SELECT RAISE(ABORT,'COFFER_FORM_CAPTURE_FROZEN'); END;
CREATE TRIGGER cf_giving_form_capture_redacted BEFORE INSERT ON cf_giving_form_intents
WHEN EXISTS(SELECT 1 FROM cf_giving_form_redactions WHERE intent_id=NEW.intent_id)
BEGIN SELECT RAISE(ABORT,'COFFER_FORM_CAPTURE_ERASED'); END;
CREATE TRIGGER cf_giving_form_gift_redacted BEFORE INSERT ON cf_giving_form_gifts
WHEN EXISTS(SELECT 1 FROM cf_giving_form_redactions WHERE intent_id=NEW.intent_id)
BEGIN SELECT RAISE(ABORT,'COFFER_FORM_CAPTURE_ERASED'); END;

-- Resolve identity through the existing intent and gift owners. Ordinary audited
-- merge and undo therefore preserves answers without copying private payloads into
-- a second donor journal. Erasure runs before money moves to its placeholder.
CREATE TRIGGER cf_giving_form_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO cf_giving_form_redactions SELECT id FROM cf_giving_intents
 WHERE donor_id=NEW.id OR (OLD.email IS NOT NULL AND lower(email)=lower(OLD.email))
 OR lower(email) IN (SELECT lower(email) FROM cf_donor_aliases WHERE donor_id=NEW.id)
 OR lower(email) IN (SELECT lower(value) FROM cf_contact_points WHERE donor_id=NEW.id AND kind='email');
 INSERT OR IGNORE INTO cf_giving_form_redactions SELECT intent_id FROM cf_giving_form_gifts
 WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
 DELETE FROM cf_giving_form_gifts WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions)
 OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
 DELETE FROM cf_giving_form_intents WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions);
END;
CREATE TRIGGER cf_giving_form_intent_erasure AFTER UPDATE OF donor_id ON cf_giving_intents
WHEN EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
BEGIN
 INSERT OR IGNORE INTO cf_giving_form_redactions VALUES(NEW.id);
 DELETE FROM cf_giving_form_gifts WHERE intent_id=NEW.id;
 DELETE FROM cf_giving_form_intents WHERE intent_id=NEW.id;
END;
CREATE TRIGGER cf_giving_form_gift_erasure AFTER UPDATE OF donor_id ON cf_gifts
WHEN EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
BEGIN
 INSERT OR IGNORE INTO cf_giving_form_redactions SELECT intent_id FROM cf_giving_form_gifts WHERE gift_id=NEW.id;
 DELETE FROM cf_giving_form_gifts WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions);
 DELETE FROM cf_giving_form_intents WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions);
END;
