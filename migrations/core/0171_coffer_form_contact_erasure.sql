-- Redact abandoned captures while historical contacts still identify their
-- donor. Contact erasure runs afterwards and removes that private history.
DROP TRIGGER cf_giving_form_erasure;
CREATE TRIGGER cf_giving_form_erasure BEFORE UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO cf_giving_form_redactions SELECT id FROM cf_giving_intents
 WHERE donor_id=NEW.id OR (OLD.email IS NOT NULL AND lower(email)=lower(OLD.email))
 OR lower(email) IN (SELECT lower(email) FROM cf_donor_aliases WHERE donor_id=NEW.id)
 OR lower(email) IN (SELECT lower(value) FROM cf_contact_points WHERE donor_id=NEW.id AND kind='email')
 OR lower(email) IN (SELECT lower(json_extract(snapshot,'$.value')) FROM cf_contact_history
                    WHERE donor_id=NEW.id AND json_extract(snapshot,'$.kind')='email');
 INSERT OR IGNORE INTO cf_giving_form_redactions SELECT intent_id FROM cf_giving_form_gifts
 WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
 DELETE FROM cf_giving_form_gifts WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions)
 OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
 DELETE FROM cf_giving_form_intents WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions);
END;
