-- Stripe owns charge attempts. This worker reconciles their result and sends one
-- card-update invitation per failed invoice, with a durable claim before mail.
CREATE TABLE cf_agent_recovery (
 invoice_id TEXT PRIMARY KEY,
 subscription_id TEXT NOT NULL REFERENCES cf_subscriptions(id),
 state TEXT NOT NULL CHECK(state IN ('waiting','recovered','lapsed')),
 attempt_count INTEGER NOT NULL,
 next_attempt_at INTEGER,
 notice_state TEXT NOT NULL DEFAULT 'pending' CHECK(notice_state IN ('pending','sending','sent','failed','skipped')),
 notice_event_id TEXT,
 notice_at TEXT,
 created_at TEXT NOT NULL,
 last_checked_at TEXT NOT NULL
);
CREATE INDEX cf_agent_recovery_subscription ON cf_agent_recovery(subscription_id);
CREATE TABLE cf_agent_recovery_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 last_run_at TEXT
);
INSERT INTO cf_agent_recovery_settings(id,enabled) VALUES(1,1);
