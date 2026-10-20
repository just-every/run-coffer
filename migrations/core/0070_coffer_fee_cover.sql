-- PAY-004: an organization-supplied estimate, never a processor fee fact.
ALTER TABLE cf_campaigns ADD COLUMN fee_cover_enabled INTEGER NOT NULL DEFAULT 0 CHECK(fee_cover_enabled IN (0,1));
ALTER TABLE cf_campaigns ADD COLUMN fee_cover_rate_bps INTEGER CHECK(fee_cover_rate_bps BETWEEN 0 AND 9999);
ALTER TABLE cf_campaigns ADD COLUMN fee_cover_fixed_cents INTEGER CHECK(fee_cover_fixed_cents>=0 AND fee_cover_fixed_cents<=10000000);
ALTER TABLE cf_campaigns ADD COLUMN fee_cover_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cf_giving_intents ADD COLUMN requested_amount_cents INTEGER;
ALTER TABLE cf_giving_intents ADD COLUMN fee_cover_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cf_giving_intents ADD COLUMN fee_cover_rate_bps INTEGER;
ALTER TABLE cf_giving_intents ADD COLUMN fee_cover_fixed_cents INTEGER;
UPDATE cf_giving_intents SET requested_amount_cents=amount_cents;
-- Row rewrites (merge, undo, restore) may restate the same values; only a change is refused.
CREATE TRIGGER cf_giving_amount_frozen BEFORE UPDATE OF amount_cents,requested_amount_cents,fee_cover_cents,fee_cover_rate_bps,fee_cover_fixed_cents ON cf_giving_intents
WHEN OLD.amount_cents IS NOT NEW.amount_cents OR OLD.requested_amount_cents IS NOT NEW.requested_amount_cents OR OLD.fee_cover_cents IS NOT NEW.fee_cover_cents
 OR OLD.fee_cover_rate_bps IS NOT NEW.fee_cover_rate_bps OR OLD.fee_cover_fixed_cents IS NOT NEW.fee_cover_fixed_cents
BEGIN SELECT RAISE(ABORT,'COFFER_CHECKOUT_AMOUNT_FROZEN'); END;
