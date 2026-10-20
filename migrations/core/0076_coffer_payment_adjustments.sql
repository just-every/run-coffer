-- PAY-003: provider identifiers and numerical facts only; donor custody follows
-- the immutable gift rather than a second copy of a donor's personal details.
CREATE TABLE cf_refund_requests (
 id TEXT PRIMARY KEY, gift_id TEXT NOT NULL REFERENCES cf_gifts(id), charge_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), expected_net_cents INTEGER NOT NULL,
 status TEXT NOT NULL, refund_id TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL, checked_at TEXT
);
CREATE TABLE cf_payment_disputes (
 id TEXT PRIMARY KEY, gift_id TEXT NOT NULL REFERENCES cf_gifts(id), charge_id TEXT NOT NULL,
 status TEXT NOT NULL, evidence_due_at TEXT, has_evidence INTEGER, past_due INTEGER, updated_at TEXT NOT NULL
);
CREATE TABLE cf_payment_notices (
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL UNIQUE REFERENCES cf_payment_entries(id),
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id), owner_id TEXT, status TEXT NOT NULL,
 created_at TEXT NOT NULL, submitted_at TEXT
);
