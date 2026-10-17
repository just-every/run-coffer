-- Processor money is an append-only subledger. Payout membership is separate:
-- a late refund belongs to its own payout, never rewrites an earlier deposit.
CREATE TABLE cf_stripe_charges (
 id TEXT PRIMARY KEY, gift_id TEXT NOT NULL REFERENCES cf_gifts(id),
 refund_baseline INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE cf_erased_stripe_customers (
 customer_id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id)
);
CREATE TABLE cf_payment_entries (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL, charge_id TEXT,
 kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL,
 net_cents INTEGER NOT NULL, fund TEXT NOT NULL,
 gift_id TEXT REFERENCES cf_gifts(id), contribution_cents INTEGER NOT NULL DEFAULT 0,
 currency TEXT NOT NULL CHECK(currency='usd'), received_on TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(net_cents=amount_cents-fee_cents)
);
CREATE INDEX cf_payment_charge ON cf_payment_entries(charge_id);
CREATE TRIGGER cf_payment_immutable BEFORE UPDATE ON cf_payment_entries
BEGIN SELECT RAISE(ABORT,'COFFER_PAYMENT_IMMUTABLE'); END;
CREATE TRIGGER cf_payment_no_delete BEFORE DELETE ON cf_payment_entries
BEGIN SELECT RAISE(ABORT,'COFFER_PAYMENT_IMMUTABLE'); END;
CREATE TABLE cf_payouts (
 id TEXT PRIMARY KEY, status TEXT NOT NULL, arrival_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, automatic INTEGER NOT NULL,
 complete INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE cf_payout_entries (
 entry_id TEXT PRIMARY KEY REFERENCES cf_payment_entries(id),
 payout_id TEXT NOT NULL REFERENCES cf_payouts(id)
);
CREATE TABLE cf_payment_failures (
 id TEXT PRIMARY KEY, charge_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE cf_payout_postings (
 payout_id TEXT PRIMARY KEY REFERENCES cf_payouts(id), state TEXT NOT NULL,
 external_id TEXT, destination TEXT NOT NULL, posted_at TEXT, proposal_id TEXT,
 payload_hash TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER cf_posted_payout_frozen BEFORE INSERT ON cf_payout_entries
WHEN EXISTS(SELECT 1 FROM cf_payout_postings WHERE payout_id=NEW.payout_id)
BEGIN SELECT RAISE(ABORT,'COFFER_POSTED_PAYOUT_FROZEN'); END;
CREATE TRIGGER cf_payout_membership_immutable BEFORE UPDATE ON cf_payout_entries
BEGIN SELECT RAISE(ABORT,'COFFER_PAYMENT_IMMUTABLE'); END;
CREATE TRIGGER cf_payout_membership_no_delete BEFORE DELETE ON cf_payout_entries
BEGIN SELECT RAISE(ABORT,'COFFER_PAYMENT_IMMUTABLE'); END;
-- Donor reporting includes processor reversals without changing an original
-- gift, or counting fees as a reduction of the donor's contribution.
CREATE VIEW cf_contribution_ledger AS
 SELECT id,version,donor_id,kind,reverses,received_on,amount_cents,method,reference,fund,pledge_id,goods,goods_cents,goods_description,note,source,created_at,created_by FROM cf_gifts
 UNION ALL
 SELECT p.id,1,g.donor_id,CASE WHEN p.contribution_cents<0 THEN 'reversal' ELSE 'gift' END,
 CASE WHEN p.contribution_cents<0 THEN g.id ELSE NULL END,p.received_on,p.contribution_cents,
 g.method,p.source_id,p.fund,g.pledge_id,'none',0,NULL,p.kind,'stripe-adjustment',p.created_at,'Stripe'
 FROM cf_payment_entries p JOIN cf_gifts g ON g.id=p.gift_id WHERE p.contribution_cents<>0;
