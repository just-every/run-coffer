-- Public giving belongs to this install; payment credentials stay at Stripe.
CREATE TABLE cf_campaigns (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 description TEXT NOT NULL, fund TEXT NOT NULL, goal_cents INTEGER NOT NULL CHECK(goal_cents > 0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE cf_giving_intents (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id),
 name TEXT NOT NULL, email TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 frequency TEXT NOT NULL CHECK(frequency IN ('once','monthly')), customer_id TEXT,
 session_id TEXT UNIQUE, donor_id TEXT REFERENCES cf_donors(id), created_at TEXT NOT NULL
);
CREATE TABLE cf_giving_customers (
 customer_id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id)
);
CREATE INDEX cf_giving_customer_donor ON cf_giving_customers(donor_id);
CREATE TABLE cf_subscriptions (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id), customer_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, status TEXT NOT NULL, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
 failed_attempts INTEGER NOT NULL DEFAULT 0, recovered INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER, updated_at TEXT NOT NULL
);
CREATE TABLE cf_campaign_gifts (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id), campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id)
);
CREATE TABLE cf_giving_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at TEXT NOT NULL);
CREATE TABLE cf_donor_tokens (
 token_hash TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 kind TEXT NOT NULL CHECK(kind IN ('link','session')), expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE cf_giving_notices (event_id TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
CREATE TABLE cf_giving_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE cf_giving_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
