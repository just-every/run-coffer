CREATE TABLE cf_pledge_checkouts (
 id TEXT PRIMARY KEY, installment_id TEXT NOT NULL REFERENCES cf_pledge_installments(id),
 amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', session_id TEXT UNIQUE, payment_id TEXT UNIQUE,
 created_at TEXT NOT NULL, gift_id TEXT REFERENCES cf_gifts(id)
);
CREATE UNIQUE INDEX cf_pledge_checkout_open ON cf_pledge_checkouts(installment_id) WHERE status='open';
