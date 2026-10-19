-- Exact source amounts sit beside each imported gift. Fully refunded charges
-- use a positive original and a kit-owned reversal; zero gifts remain invalid.
CREATE TABLE cf_import_refunds (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 gross_cents INTEGER NOT NULL CHECK(gross_cents > 0),
 refunded_cents INTEGER NOT NULL CHECK(refunded_cents >= 0 AND refunded_cents <= gross_cents),
 net_cents INTEGER NOT NULL CHECK(net_cents = gross_cents - refunded_cents),
 status TEXT NOT NULL CHECK(status IN ('paid','partially_refunded','refunded')),
 CHECK((status='refunded' AND net_cents=0) OR (status='paid' AND refunded_cents=0) OR (status='partially_refunded' AND refunded_cents>0 AND net_cents>0))
);

-- Reconciliation must not subtract an already retained full reversal again.
-- Partial refunds already have their baseline in gross minus the net gift.
CREATE TRIGGER cf_import_refund_baseline AFTER INSERT ON cf_stripe_charges
WHEN EXISTS(SELECT 1 FROM cf_import_refunds WHERE gift_id=NEW.gift_id AND status='refunded')
BEGIN
 UPDATE cf_stripe_charges SET refund_baseline=(SELECT refunded_cents FROM cf_import_refunds WHERE gift_id=NEW.gift_id) WHERE id=NEW.id;
END;
