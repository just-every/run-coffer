-- Keep the original recurring discriminator for existing integrations.
ALTER TABLE cf_giving_intents ADD COLUMN billing_frequency TEXT NOT NULL DEFAULT 'monthly'
 CHECK(billing_frequency IN ('once','monthly','quarterly','annually'));
UPDATE cf_giving_intents SET billing_frequency=frequency;

ALTER TABLE cf_subscription_history ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'month';
ALTER TABLE cf_subscription_history ADD COLUMN interval_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cf_subscription_history ADD COLUMN collection_paused INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER cf_subscription_health_update;
CREATE TRIGGER cf_subscription_health_update AFTER UPDATE ON cf_subscriptions
WHEN OLD.status<>NEW.status OR OLD.amount_cents<>NEW.amount_cents OR OLD.cancel_at_period_end<>NEW.cancel_at_period_end BEGIN
 INSERT INTO cf_subscription_history(subscription_id,observed_at,status,amount_cents,cancel_at_period_end,billing_interval,interval_count,collection_paused)
 SELECT NEW.id,NEW.updated_at,NEW.status,NEW.amount_cents,NEW.cancel_at_period_end,
 COALESCE(p.interval,'month'),COALESCE(p.interval_count,1),COALESCE(p.collection_paused,0)
 FROM (SELECT 1) LEFT JOIN cf_portal_subscription_settings p ON p.subscription_id=NEW.id;
END;
CREATE TRIGGER cf_subscription_schedule_insert AFTER INSERT ON cf_portal_subscription_settings BEGIN
 INSERT INTO cf_subscription_history(subscription_id,observed_at,status,amount_cents,cancel_at_period_end,billing_interval,interval_count,collection_paused)
 SELECT s.id,NEW.observed_at,s.status,s.amount_cents,s.cancel_at_period_end,NEW.interval,NEW.interval_count,NEW.collection_paused FROM cf_subscriptions s WHERE s.id=NEW.subscription_id;
END;
CREATE TRIGGER cf_subscription_schedule_update AFTER UPDATE ON cf_portal_subscription_settings
WHEN OLD.interval<>NEW.interval OR OLD.interval_count<>NEW.interval_count OR OLD.collection_paused<>NEW.collection_paused BEGIN
 INSERT INTO cf_subscription_history(subscription_id,observed_at,status,amount_cents,cancel_at_period_end,billing_interval,interval_count,collection_paused)
 SELECT s.id,NEW.observed_at,s.status,s.amount_cents,s.cancel_at_period_end,NEW.interval,NEW.interval_count,NEW.collection_paused FROM cf_subscriptions s WHERE s.id=NEW.subscription_id;
END;
