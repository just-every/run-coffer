-- Schedules and allocations leave the immutable gift ledger unchanged.
CREATE TABLE cf_pledge_installments (
 id TEXT PRIMARY KEY,
 pledge_id TEXT NOT NULL REFERENCES cf_pledges(id),
 position INTEGER NOT NULL CHECK(position > 0),
 due_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 remind_on TEXT NOT NULL,
 reminder_status TEXT NOT NULL DEFAULT 'pending' CHECK(reminder_status IN ('pending','sending','submitted','rejected','uncertain','skipped')),
 attempt_id TEXT UNIQUE,
 attempt_started_at TEXT,
 recipient_email TEXT,
 message_id TEXT,
 submitted_at TEXT,
 reminder_note TEXT,
 UNIQUE(pledge_id,position)
);
CREATE INDEX cf_pledge_reminder_due ON cf_pledge_installments(reminder_status,remind_on);
CREATE TABLE cf_pledge_allocations (
 id TEXT PRIMARY KEY,
 installment_id TEXT NOT NULL REFERENCES cf_pledge_installments(id),
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 UNIQUE(installment_id,gift_id)
);
CREATE INDEX cf_pledge_allocation_gift ON cf_pledge_allocations(gift_id);
-- Reversal lines undo their original gift's allocations without editing history.
CREATE VIEW cf_pledge_balances AS
 SELECT i.*,COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_allocations a
 JOIN cf_gifts g ON g.id=a.gift_id AND g.kind='gift'
 WHERE a.installment_id=i.id AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)),0) AS paid_cents
 FROM cf_pledge_installments i;
