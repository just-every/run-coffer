-- Draft rows carry no ledger money. Closing publishes one immutable deposit and its gifts.
CREATE TABLE cf_gift_batches (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
 name TEXT NOT NULL, received_on TEXT NOT NULL, fund TEXT NOT NULL,
 campaign_id TEXT REFERENCES cf_campaigns(id), appeal TEXT REFERENCES cf_appeal_codes(code),
 method TEXT NOT NULL CHECK(method IN ('check','cash')), expected_cents INTEGER NOT NULL CHECK(expected_cents>0),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL, closed_at TEXT, closed_by TEXT
);
CREATE TABLE cf_batch_entries (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES cf_gift_batches(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reference TEXT, goods TEXT NOT NULL CHECK(goods IN ('none','provided')),
 goods_cents INTEGER NOT NULL DEFAULT 0, goods_description TEXT,
 gift_id TEXT UNIQUE REFERENCES cf_gifts(id), created_at TEXT NOT NULL
);
CREATE INDEX cf_batch_entries_batch ON cf_batch_entries(batch_id);
CREATE TRIGGER cf_batch_closed_update BEFORE UPDATE ON cf_gift_batches WHEN OLD.status='closed' BEGIN
 SELECT RAISE(ABORT,'COFFER_CLOSED_DEPOSIT');
END;
CREATE TRIGGER cf_batch_closed_entry_update BEFORE UPDATE ON cf_batch_entries WHEN (SELECT status FROM cf_gift_batches WHERE id=OLD.batch_id)='closed' AND (NEW.id<>OLD.id OR NEW.batch_id<>OLD.batch_id OR NEW.amount_cents<>OLD.amount_cents OR NEW.reference IS NOT OLD.reference OR NEW.goods<>OLD.goods OR NEW.goods_cents<>OLD.goods_cents OR NEW.gift_id IS NOT OLD.gift_id) BEGIN
 SELECT RAISE(ABORT,'COFFER_CLOSED_DEPOSIT');
END;
CREATE TRIGGER cf_batch_closed_entry_delete BEFORE DELETE ON cf_batch_entries WHEN (SELECT status FROM cf_gift_batches WHERE id=OLD.batch_id)='closed' BEGIN
 SELECT RAISE(ABORT,'COFFER_CLOSED_DEPOSIT');
END;
-- Follow the donor ledger's merge/erasure identity, without changing closed money or check facts.
CREATE TRIGGER cf_batch_donor_custody AFTER UPDATE OF donor_id ON cf_gifts BEGIN
 UPDATE cf_batch_entries SET donor_id=NEW.donor_id WHERE gift_id=NEW.id AND donor_id<>NEW.donor_id;
 UPDATE cf_batch_entries SET goods_description=NULL WHERE gift_id=NEW.id AND EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL);
END;

CREATE TRIGGER cf_batch_draft_erasure BEFORE DELETE ON cf_donors BEGIN
 UPDATE cf_gift_batches SET version=version+1 WHERE status='open' AND id IN (SELECT batch_id FROM cf_batch_entries WHERE donor_id=OLD.id AND gift_id IS NULL);
 DELETE FROM cf_batch_entries WHERE donor_id=OLD.id AND gift_id IS NULL;
END;
