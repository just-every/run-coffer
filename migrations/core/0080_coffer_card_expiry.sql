-- GIVE-006: only the current default method's opaque reference and expiration.
-- Claims precede mail; an uncertain external send is never automatically retried.
CREATE TABLE cf_card_expiry_notices (
 subscription_id TEXT PRIMARY KEY REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 payment_method_id TEXT NOT NULL,
 expiry_year INTEGER NOT NULL,
 expiry_month INTEGER NOT NULL CHECK(expiry_month BETWEEN 1 AND 12),
 claim_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','sent','failed','skipped')),
 checked_at TEXT NOT NULL
);
CREATE TRIGGER cf_card_expiry_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_card_expiry_notices WHERE subscription_id IN (SELECT id FROM cf_subscriptions WHERE donor_id=NEW.id);
END;
