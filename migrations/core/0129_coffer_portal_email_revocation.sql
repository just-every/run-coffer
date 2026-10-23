-- Portal links and sessions belong to the address they were mailed to. Every
-- door that changes a donor's email ends them in the same transaction.
CREATE TRIGGER cf_donor_email_portal_revocation AFTER UPDATE OF email ON cf_donors
WHEN OLD.email IS NOT NEW.email
BEGIN
 DELETE FROM cf_donor_tokens WHERE donor_id=NEW.id;
END;
