-- Collection and authorization stay at Stripe. Only opaque references are retained.
ALTER TABLE cf_giving_intents ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'card' CHECK(payment_method IN ('card','us_bank_account'));
ALTER TABLE cf_giving_intents ADD COLUMN bank_submission_state TEXT NOT NULL DEFAULT 'unsubmitted' CHECK(bank_submission_state IN ('unsubmitted','uncertain','created'));
CREATE TRIGGER cf_checkout_method_frozen BEFORE UPDATE OF payment_method ON cf_giving_intents
WHEN NEW.payment_method<>OLD.payment_method BEGIN SELECT RAISE(ABORT,'COFFER_CHECKOUT_METHOD_FROZEN'); END;
CREATE TABLE cf_bank_checkouts (
 intent_id TEXT PRIMARY KEY REFERENCES cf_giving_intents(id),
 payment_intent_id TEXT NOT NULL UNIQUE, payment_method_id TEXT NOT NULL, mandate_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('processing','succeeded','failed','returned')), observed_at TEXT NOT NULL
);
CREATE TRIGGER cf_bank_binding_frozen BEFORE UPDATE OF payment_intent_id,payment_method_id,mandate_id ON cf_bank_checkouts
WHEN NEW.payment_intent_id<>OLD.payment_intent_id OR NEW.payment_method_id<>OLD.payment_method_id OR NEW.mandate_id<>OLD.mandate_id
BEGIN SELECT RAISE(ABORT,'COFFER_BANK_BINDING_FROZEN'); END;
CREATE TABLE cf_bank_returns (
 charge_id TEXT PRIMARY KEY REFERENCES cf_stripe_charges(id), dispute_id TEXT NOT NULL UNIQUE,
 entry_id TEXT NOT NULL UNIQUE REFERENCES cf_payment_entries(id), return_code TEXT NOT NULL,
 task_id TEXT REFERENCES cf_call_tasks(id) ON DELETE SET NULL, recorded_at TEXT NOT NULL
);
