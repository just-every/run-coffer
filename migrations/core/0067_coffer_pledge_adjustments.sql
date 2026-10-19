-- Original commitments and cash never change when a pledge is reduced.
ALTER TABLE cf_pledges ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE cf_pledge_adjustments (
 id TEXT PRIMARY KEY,
 pledge_id TEXT NOT NULL REFERENCES cf_pledges(id),
 installment_id TEXT REFERENCES cf_pledge_installments(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 kind TEXT NOT NULL CHECK(kind IN ('reduction','write_off')),
 reason TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE INDEX cf_pledge_adjustments_parent ON cf_pledge_adjustments(pledge_id);
CREATE TRIGGER cf_pledge_adjustment_immutable BEFORE UPDATE ON cf_pledge_adjustments
 WHEN NEW.id IS NOT OLD.id OR NEW.pledge_id IS NOT OLD.pledge_id OR NEW.installment_id IS NOT OLD.installment_id
 OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at
 OR NEW.created_by IS NOT OLD.created_by OR (NEW.reason IS NOT OLD.reason AND NEW.reason IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'COFFER_PLEDGE_ADJUSTMENT_IMMUTABLE'); END;
CREATE TABLE cf_pledge_plans (
 pledge_id TEXT PRIMARY KEY REFERENCES cf_pledges(id),
 subscription_id TEXT NOT NULL UNIQUE REFERENCES cf_subscriptions(id),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE VIEW cf_pledge_totals AS SELECT p.*,
 COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_adjustments a WHERE a.pledge_id=p.id),0) AS reduced_cents
 FROM cf_pledges p;
-- Keep effective installment amounts at the public balance door used by reminders/tasks.
CREATE VIEW cf_pledge_payment_balances AS
 SELECT i.*,COALESCE((SELECT SUM(MAX(0,MIN(a.amount_cents,g.net_cents-
  COALESCE((SELECT SUM(prior.amount_cents) FROM cf_pledge_allocations prior WHERE prior.gift_id=a.gift_id
   AND (prior.created_at<a.created_at OR (prior.created_at=a.created_at AND prior.id<a.id))),0))))
 FROM cf_pledge_allocations a JOIN cf_gift_balances g ON g.id=a.gift_id WHERE a.installment_id=i.id),0) AS paid_cents
 FROM cf_pledge_installments i;
DROP VIEW cf_pledge_balances;
CREATE VIEW cf_pledge_balances AS SELECT i.id,i.pledge_id,i.position,i.due_on,
 i.amount_cents-COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_adjustments a WHERE a.installment_id=i.id),0) AS amount_cents,
 i.amount_cents AS original_amount_cents,i.remind_on,i.reminder_status,i.attempt_id,i.attempt_started_at,
 i.recipient_email,i.message_id,i.submitted_at,i.reminder_note,i.paid_cents FROM cf_pledge_payment_balances i;
CREATE TRIGGER cf_pledge_payment_version AFTER INSERT ON cf_pledge_allocations BEGIN
 UPDATE cf_pledges SET version=version+1 WHERE id=(SELECT pledge_id FROM cf_pledge_installments WHERE id=NEW.installment_id);
END;
-- A successful recurring gift fills the earliest unpaid installments once.
-- The window materializes all remaining amounts before inserting allocations.
CREATE TRIGGER cf_pledge_recurring_payment AFTER INSERT ON cf_subscription_gifts BEGIN
 INSERT OR IGNORE INTO cf_pledge_allocations(id,installment_id,gift_id,amount_cents,created_at,created_by)
 SELECT NEW.gift_id||':'||q.id,q.id,NEW.gift_id,MIN(q.remaining,q.available-q.prior),q.created_at,'Recurring plan'
 FROM (SELECT i.id,i.amount_cents-i.paid_cents AS remaining,g.net_cents AS available,g.created_at,
 COALESCE(SUM(i.amount_cents-i.paid_cents) OVER(ORDER BY i.due_on,i.position,i.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior
 FROM cf_pledge_plans link JOIN cf_pledges p ON p.id=link.pledge_id
 JOIN cf_pledge_balances i ON i.pledge_id=p.id
 JOIN cf_gift_balances g ON g.id=NEW.gift_id AND g.donor_id=p.donor_id AND g.fund=p.fund
 JOIN cf_donors d ON d.id=p.donor_id AND d.erased_at IS NULL
 WHERE link.subscription_id=NEW.subscription_id AND i.amount_cents>i.paid_cents
 AND NOT EXISTS(SELECT 1 FROM cf_pledge_allocations a WHERE a.gift_id=g.id)) q
 WHERE q.available>q.prior;
END;
CREATE TRIGGER cf_pledge_legacy_payment_version AFTER INSERT ON cf_gifts WHEN NEW.pledge_id IS NOT NULL BEGIN
 UPDATE cf_pledges SET version=version+1 WHERE id=NEW.pledge_id;
END;
-- Older commitments with a recorded final due date preserve that exact date
-- as a single installment and keep each original payment allocation visible.
INSERT INTO cf_pledge_installments(id,pledge_id,position,due_on,amount_cents,remind_on)
 SELECT 'legacy-pledge-'||p.id,p.id,1,p.due_by,p.amount_cents,date(p.due_by,'-7 days') FROM cf_pledges p
 WHERE p.due_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_pledge_installments i WHERE i.pledge_id=p.id);
INSERT INTO cf_pledge_allocations(id,installment_id,gift_id,amount_cents,created_at,created_by)
 SELECT 'legacy-payment-'||g.id,i.id,g.id,g.amount_cents,g.created_at,g.created_by FROM cf_gifts g
 JOIN cf_pledge_installments i ON i.pledge_id=g.pledge_id AND i.id='legacy-pledge-'||g.pledge_id
 WHERE g.kind='gift' AND g.amount_cents>0;
