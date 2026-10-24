-- One durable submission claim per installment; payment and identity stay native.
CREATE TABLE cf_pledge_followups (
 installment_id TEXT PRIMARY KEY REFERENCES cf_pledge_installments(id),
 attempt_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
 recipient_email TEXT, body TEXT, message_id TEXT, attempted_at TEXT NOT NULL
);
CREATE TRIGGER cf_pledge_followup_erasure AFTER UPDATE OF erased_at ON cf_donors WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_pledge_followups WHERE installment_id IN (SELECT i.id FROM cf_pledge_installments i JOIN cf_pledges p ON p.id=i.pledge_id WHERE p.donor_id=NEW.id);
END;
CREATE TABLE cf_pending_bank_payments (
 id TEXT PRIMARY KEY, fund TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 received_on TEXT NOT NULL, status TEXT NOT NULL
);
