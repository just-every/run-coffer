-- Merged source identities stay as import aliases; financial facts stay fixed.
CREATE TABLE cf_donor_merges (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id),
 into_id TEXT NOT NULL REFERENCES cf_donors(id),
 merged_at TEXT NOT NULL,
 merged_by TEXT NOT NULL,
 CHECK(donor_id<>into_id)
);
CREATE INDEX cf_donor_merge_target ON cf_donor_merges(into_id);
CREATE TABLE cf_gift_appeals (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 appeal TEXT NOT NULL
);
DROP TRIGGER cf_gift_immutable;
CREATE TRIGGER cf_gift_immutable BEFORE UPDATE ON cf_gifts
WHEN NEW.id IS NOT OLD.id OR (NEW.donor_id IS NOT OLD.donor_id
 AND NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=OLD.donor_id AND into_id=NEW.donor_id))
 OR NEW.kind IS NOT OLD.kind OR NEW.reverses IS NOT OLD.reverses
 OR NEW.received_on IS NOT OLD.received_on OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.method IS NOT OLD.method
 OR NEW.reference IS NOT OLD.reference OR NEW.fund IS NOT OLD.fund OR NEW.pledge_id IS NOT OLD.pledge_id
 OR NEW.source IS NOT OLD.source OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.note IS NOT OLD.note AND NEW.note IS NOT NULL)
 OR ((NEW.goods IS NOT OLD.goods OR NEW.goods_cents IS NOT OLD.goods_cents OR NEW.goods_description IS NOT OLD.goods_description) AND OLD.goods <> 'unknown')
BEGIN SELECT RAISE(ABORT, 'COFFER_GIFT_IMMUTABLE'); END;
DROP TRIGGER cf_consent_append_only;
CREATE TRIGGER cf_consent_append_only BEFORE UPDATE ON cf_consents
WHEN NEW.id IS NOT OLD.id OR NEW.channel IS NOT OLD.channel OR NEW.status IS NOT OLD.status
 OR NEW.method IS NOT OLD.method OR NEW.evidence IS NOT OLD.evidence OR NEW.captured_on IS NOT OLD.captured_on
 OR NEW.recorded_at IS NOT OLD.recorded_at OR NEW.recorded_by IS NOT OLD.recorded_by
 OR NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=OLD.donor_id AND into_id=NEW.donor_id)
BEGIN SELECT RAISE(ABORT, 'COFFER_CONSENT_APPEND_ONLY'); END;

-- The payments subledger changes contribution balances without editing gifts.
CREATE VIEW cf_gift_balances AS
 SELECT g.*,CASE WHEN EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id) THEN 0
 ELSE MAX(0,g.amount_cents+COALESCE((SELECT SUM(p.contribution_cents) FROM cf_payment_entries p WHERE p.gift_id=g.id),0)) END AS net_cents
 FROM cf_gifts g WHERE g.kind='gift';
DROP VIEW cf_pledge_balances;
CREATE VIEW cf_pledge_balances AS
 SELECT i.*,COALESCE((SELECT SUM(MAX(0,MIN(a.amount_cents,g.net_cents-
  COALESCE((SELECT SUM(prior.amount_cents) FROM cf_pledge_allocations prior WHERE prior.gift_id=a.gift_id
   AND (prior.created_at<a.created_at OR (prior.created_at=a.created_at AND prior.id<a.id))),0))))
 FROM cf_pledge_allocations a JOIN cf_gift_balances g ON g.id=a.gift_id WHERE a.installment_id=i.id),0) AS paid_cents
 FROM cf_pledge_installments i;
