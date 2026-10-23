-- Asynchronous import, form and audited merge writes preserve distinct people.
-- The marker is inserted and removed in the same atomic batch; staff writes
-- retain synchronous unrelated-email refusal. Duplicate review indexes contacts.
CREATE TABLE cf_identity_ingest(id INTEGER PRIMARY KEY CHECK(id=1));

DROP TRIGGER cf_donor_email_insert;
CREATE TRIGGER cf_donor_email_insert BEFORE INSERT ON cf_donors
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NEW.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=NEW.id)
 AND EXISTS(SELECT 1 FROM (SELECT NEW.email AS email WHERE NEW.email IS NOT NULL UNION SELECT value AS email FROM cf_contact_points WHERE donor_id=NEW.id AND kind='email' AND active=1 AND is_primary=0) own JOIN (SELECT id AS donor_id,email FROM cf_donors WHERE email IS NOT NULL UNION SELECT donor_id,value AS email FROM cf_contact_points WHERE kind='email' AND active=1) a ON a.email=own.email
 LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id JOIN cf_donors other ON other.id=COALESCE(m.into_id,a.donor_id)
 WHERE other.id<>NEW.id AND other.erased_at IS NULL AND (NEW.household_id IS NULL OR other.household_id IS NULL OR other.household_id<>NEW.household_id))
BEGIN SELECT RAISE(ABORT,'COFFER_DUPLICATE_EMAIL'); END;

DROP TRIGGER cf_donor_email_update;
CREATE TRIGGER cf_donor_email_update BEFORE UPDATE OF email,household_id ON cf_donors
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NEW.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=NEW.id)
 AND EXISTS(SELECT 1 FROM (SELECT NEW.email AS email WHERE NEW.email IS NOT NULL UNION SELECT value AS email FROM cf_contact_points WHERE donor_id=NEW.id AND kind='email' AND active=1 AND is_primary=0) own JOIN (SELECT id AS donor_id,email FROM cf_donors WHERE email IS NOT NULL UNION SELECT donor_id,value AS email FROM cf_contact_points WHERE kind='email' AND active=1) a ON a.email=own.email
 LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id JOIN cf_donors other ON other.id=COALESCE(m.into_id,a.donor_id)
 WHERE other.id<>NEW.id AND other.erased_at IS NULL AND (NEW.household_id IS NULL OR other.household_id IS NULL OR other.household_id<>NEW.household_id))
BEGIN SELECT RAISE(ABORT,'COFFER_DUPLICATE_EMAIL'); END;
DROP TRIGGER cf_contact_email_insert;
CREATE TRIGGER cf_contact_email_insert BEFORE INSERT ON cf_contact_points
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NEW.kind='email' AND NEW.active=1 AND NOT EXISTS(SELECT 1 FROM cf_contact_edit)
 AND EXISTS(SELECT 1 FROM (SELECT id AS donor_id,email FROM cf_donors WHERE email IS NOT NULL UNION SELECT donor_id,value AS email FROM cf_contact_points WHERE kind='email' AND active=1) a LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id
 JOIN cf_donors other ON other.id=COALESCE(m.into_id,a.donor_id) JOIN cf_donors owner ON owner.id=NEW.donor_id
 WHERE a.email=NEW.value AND other.id<>owner.id AND other.erased_at IS NULL
 AND (owner.household_id IS NULL OR other.household_id IS NULL OR other.household_id<>owner.household_id))
BEGIN SELECT RAISE(ABORT,'COFFER_DUPLICATE_EMAIL'); END;
DROP TRIGGER cf_contact_email_update;
CREATE TRIGGER cf_contact_email_update BEFORE UPDATE OF value,donor_id,active ON cf_contact_points
WHEN NOT EXISTS(SELECT 1 FROM cf_identity_ingest) AND NEW.kind='email' AND NEW.active=1 AND NOT EXISTS(SELECT 1 FROM cf_contact_edit)
 AND EXISTS(SELECT 1 FROM (SELECT id AS donor_id,email FROM cf_donors WHERE email IS NOT NULL UNION SELECT donor_id,value AS email FROM cf_contact_points WHERE kind='email' AND active=1) a LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id
 JOIN cf_donors other ON other.id=COALESCE(m.into_id,a.donor_id) JOIN cf_donors owner ON owner.id=NEW.donor_id
 WHERE a.email=NEW.value AND other.id<>owner.id AND other.erased_at IS NULL
 AND (owner.household_id IS NULL OR other.household_id IS NULL OR other.household_id<>owner.household_id))
BEGIN SELECT RAISE(ABORT,'COFFER_DUPLICATE_EMAIL'); END;
