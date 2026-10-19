CREATE TABLE cf_subscription_lifetimes (
 subscription_id TEXT PRIMARY KEY REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL,
 start_known INTEGER NOT NULL DEFAULT 0 CHECK(start_known IN (0,1))
);
CREATE TABLE cf_subscription_history (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 subscription_id TEXT NOT NULL REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 observed_at TEXT NOT NULL,
 status TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 cancel_at_period_end INTEGER NOT NULL
);
CREATE INDEX cf_subscription_history_plan ON cf_subscription_history(subscription_id,observed_at,sequence);
-- Existing latest state is a baseline, never a fabricated history of earlier months.
INSERT INTO cf_subscription_lifetimes SELECT id,updated_at,0 FROM cf_subscriptions;
INSERT INTO cf_subscription_history(subscription_id,observed_at,status,amount_cents,cancel_at_period_end)
 SELECT id,updated_at,status,amount_cents,cancel_at_period_end FROM cf_subscriptions;
CREATE TRIGGER cf_subscription_health_insert AFTER INSERT ON cf_subscriptions BEGIN
 INSERT INTO cf_subscription_lifetimes VALUES(NEW.id,NEW.updated_at,0);
 INSERT INTO cf_subscription_history(subscription_id,observed_at,status,amount_cents,cancel_at_period_end)
 VALUES(NEW.id,NEW.updated_at,NEW.status,NEW.amount_cents,NEW.cancel_at_period_end);
END;
CREATE TRIGGER cf_subscription_health_update AFTER UPDATE ON cf_subscriptions
WHEN OLD.status<>NEW.status OR OLD.amount_cents<>NEW.amount_cents OR OLD.cancel_at_period_end<>NEW.cancel_at_period_end BEGIN
 INSERT INTO cf_subscription_history(subscription_id,observed_at,status,amount_cents,cancel_at_period_end)
 VALUES(NEW.id,NEW.updated_at,NEW.status,NEW.amount_cents,NEW.cancel_at_period_end);
END;
CREATE TABLE cf_recurring_payment_health (
 invoice_id TEXT PRIMARY KEY,
 subscription_id TEXT NOT NULL REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 failed_at TEXT NOT NULL,
 recovered_at TEXT
);
