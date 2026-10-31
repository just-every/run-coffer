-- Approval is installation authority and is deliberately excluded from archives.
ALTER TABLE cf_giving_intents ADD COLUMN native_plan_id TEXT;
CREATE TABLE cf_native_plans (
 id TEXT PRIMARY KEY REFERENCES cf_subscriptions(id),
 intent_id TEXT NOT NULL UNIQUE REFERENCES cf_giving_intents(id),
 version INTEGER NOT NULL DEFAULT 1,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 donor_version INTEGER NOT NULL,
 customer_id TEXT NOT NULL,
 payment_method_id TEXT NOT NULL,
 consent_id INTEGER NOT NULL,
 source_ref TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
 next_due_on TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE cf_native_plan_approvals (
 plan_id TEXT PRIMARY KEY REFERENCES cf_native_plans(id),
 plan_version INTEGER NOT NULL,
 approved_by TEXT NOT NULL,
 approver_version INTEGER NOT NULL,
 approved_at TEXT NOT NULL
);
CREATE TABLE cf_native_installments (
 id TEXT PRIMARY KEY,
 plan_id TEXT NOT NULL REFERENCES cf_native_plans(id),
 plan_version INTEGER NOT NULL,
 due_on TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('claimed','submitting','uncertain','failed','paid','blocked')),
 payment_intent_id TEXT UNIQUE,
 gift_id TEXT UNIQUE REFERENCES cf_gifts(id),
 created_at TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 UNIQUE(plan_id,due_on)
);
CREATE TRIGGER cf_native_identity_move AFTER UPDATE OF donor_id ON cf_subscriptions
WHEN OLD.donor_id<>NEW.donor_id BEGIN
 DELETE FROM cf_native_plan_approvals WHERE plan_id=NEW.id;
 UPDATE cf_subscriptions SET status='canceled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=NEW.id AND EXISTS(SELECT 1 FROM cf_native_plans WHERE id=NEW.id);
END;
CREATE TRIGGER cf_native_identity_erase AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_native_plan_approvals WHERE plan_id IN(SELECT id FROM cf_native_plans WHERE donor_id=NEW.id);
 UPDATE cf_subscriptions SET status='canceled',updated_at=NEW.erased_at
 WHERE id IN(SELECT id FROM cf_native_plans WHERE donor_id=NEW.id);
 UPDATE cf_native_plans SET source_ref='',source_hash='' WHERE donor_id=NEW.id;
END;
