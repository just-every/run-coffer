-- Attribution is separate from the immutable cash ledger. A credit or expected
-- match never creates cash, a tax receipt, or a second financial total.
CREATE TABLE cf_soft_credits (
 id TEXT PRIMARY KEY,
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 UNIQUE(gift_id, donor_id)
);
CREATE INDEX cf_soft_credit_donor ON cf_soft_credits(donor_id);
CREATE TABLE cf_gift_tributes (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version > 0),
 kind TEXT NOT NULL CHECK(kind IN ('honor','memory')),
 honoree TEXT NOT NULL,
 notified_name TEXT,
 notified_email TEXT,
 donor_id TEXT REFERENCES cf_donors(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE TABLE cf_employer_matches (
 id TEXT PRIMARY KEY,
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id) ON DELETE CASCADE,
 employer_donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 due_by TEXT NOT NULL,
 received_gift_id TEXT UNIQUE REFERENCES cf_gifts(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 UNIQUE(gift_id, employer_donor_id),
 CHECK(received_gift_id IS NULL OR received_gift_id <> gift_id)
);
CREATE INDEX cf_employer_match_donor ON cf_employer_matches(employer_donor_id);
-- Native erasure moves ledger lines to an anonymous placeholder before deleting
-- the original donor. Clear personal attribution while its old links still exist.
CREATE TRIGGER cf_gift_depth_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 -- A tribute can name this donor on somebody else's receipt. Redact those
 -- frozen artifacts too; their old approval hash deliberately stops delivery.
 UPDATE cf_acks SET subject='[erased]',body='[erased]',statement_gifts=NULL
 WHERE gift_id IN (SELECT gift_id FROM cf_gift_tributes WHERE donor_id=NEW.id)
  OR EXISTS(SELECT 1 FROM json_each(cf_acks.statement_gifts) j JOIN cf_gift_tributes t ON t.gift_id=json_extract(j.value,'$.id') WHERE t.donor_id=NEW.id);
 DELETE FROM cf_soft_credits WHERE donor_id=NEW.id OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
 DELETE FROM cf_gift_tributes WHERE donor_id=NEW.id OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
 DELETE FROM cf_employer_matches WHERE employer_donor_id=NEW.id OR gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id);
END;
