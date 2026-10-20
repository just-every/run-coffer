ALTER TABLE cf_gift_tributes ADD COLUMN notified_address TEXT;
ALTER TABLE cf_gift_tributes ADD COLUMN amount_permission INTEGER NOT NULL DEFAULT 0 CHECK(amount_permission IN (0,1));
ALTER TABLE cf_gift_tributes ADD COLUMN group_key TEXT;
ALTER TABLE cf_gift_tributes ADD COLUMN source_group TEXT;
CREATE TABLE cf_giving_tributes (
 intent_id TEXT PRIMARY KEY REFERENCES cf_giving_intents(id) ON DELETE CASCADE,
 kind TEXT CHECK(kind IN ('honor','memory')), honoree TEXT,
 notified_name TEXT, notified_email TEXT, notified_address TEXT,
 amount_permission INTEGER NOT NULL DEFAULT 0 CHECK(amount_permission IN (0,1))
);
INSERT INTO cf_giving_tributes(intent_id,amount_permission) SELECT id,0 FROM cf_giving_intents;
CREATE TABLE cf_tribute_notifications (
 id TEXT PRIMARY KEY, gift_id TEXT NOT NULL REFERENCES cf_gifts(id), version INTEGER NOT NULL DEFAULT 1,
 tribute_version INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','approved')), subject TEXT NOT NULL, body TEXT NOT NULL,
 recipient_name TEXT NOT NULL, recipient_email TEXT, recipient_address TEXT,
 prepared_at TEXT NOT NULL, prepared_by TEXT NOT NULL, approved_at TEXT, approved_by TEXT
);
CREATE TRIGGER cf_tribute_notification_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_tribute_notifications WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=NEW.id) OR gift_id IN (SELECT gift_id FROM cf_gift_tributes WHERE donor_id=NEW.id);
 DELETE FROM cf_giving_tributes WHERE intent_id IN (SELECT id FROM cf_giving_intents WHERE donor_id=NEW.id OR email=OLD.email);
END;
