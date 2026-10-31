-- Private review evidence never grants a reusable customer association.
CREATE TABLE cf_payment_donor_matches (
 charge_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, account_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('held','approved','resolved','erased')),
 customer_id TEXT, email TEXT, facts TEXT NOT NULL CHECK(json_valid(facts)),
 candidates TEXT NOT NULL CHECK(json_valid(candidates)),
 donor_id TEXT REFERENCES cf_donors(id), donor_version INTEGER,
 approved_version INTEGER, approved_by TEXT, approved_actor_version INTEGER, approved_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE cf_payment_match_payouts (
 charge_id TEXT NOT NULL REFERENCES cf_payment_donor_matches(charge_id),
 payout_id TEXT NOT NULL REFERENCES cf_payouts(id),
 PRIMARY KEY(charge_id,payout_id)
);
