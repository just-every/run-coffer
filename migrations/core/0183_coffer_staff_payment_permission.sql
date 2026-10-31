-- Existing donor permission continues to authorize recurring gifts only.
ALTER TABLE cf_saved_card_consents ADD COLUMN scope TEXT NOT NULL DEFAULT 'recurring' CHECK(scope IN ('recurring','once'));
CREATE INDEX cf_saved_card_consent_scope ON cf_saved_card_consents(donor_id,customer_id,payment_method_id,scope,id DESC);

-- Private staff authorization requests follow aliases through erasure as well.
CREATE TRIGGER cf_staff_payment_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_portal_changes WHERE action='staff.payment' AND
 (donor_id=NEW.id OR donor_id IN (SELECT donor_id FROM cf_donor_merges WHERE into_id=NEW.id));
END;
