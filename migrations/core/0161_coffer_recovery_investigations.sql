-- Each unknown provider submission needs its own attributed investigation.
CREATE TABLE cf_recovery_investigations (
 step_id TEXT PRIMARY KEY REFERENCES cf_recovery_steps(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 finding TEXT NOT NULL,reason TEXT NOT NULL,closed_by TEXT NOT NULL,closed_at TEXT NOT NULL
);
