-- Processor refunds and refund reversals append monetary contribution rows.
-- Original charges have zero contribution cents and already emit via cf_gifts.
CREATE TRIGGER cf_webhook_payment_entry AFTER INSERT ON cf_payment_entries
WHEN NEW.contribution_cents<>0
 AND EXISTS(SELECT 1 FROM cf_gifts WHERE id=NEW.gift_id)
 AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN
 INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at)
 VALUES(lower(hex(randomblob(16))),CASE WHEN NEW.contribution_cents<0 THEN 'gift.reversed' ELSE 'gift.created' END,NEW.id,NEW.created_at);
END;
