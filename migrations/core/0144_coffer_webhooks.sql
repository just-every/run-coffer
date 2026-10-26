-- Installation-specific approvals and signing keys never travel in archives.
CREATE TABLE cf_webhook_subscriptions (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL, events TEXT NOT NULL,
 sealed_secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, approved_by TEXT NOT NULL, approver_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE cf_webhook_events (
 id TEXT PRIMARY KEY, event_type TEXT NOT NULL, subject_id TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE cf_webhook_deliveries (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES cf_webhook_subscriptions(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL REFERENCES cf_webhook_events(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','failed','delivered','exhausted','held')),
 attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, last_status INTEGER,
 replay_of TEXT REFERENCES cf_webhook_deliveries(id) ON DELETE SET NULL,
 lease_token TEXT, lease_until TEXT, created_at TEXT NOT NULL
);
CREATE INDEX cf_webhook_due ON cf_webhook_deliveries(status,next_at);
CREATE TABLE cf_webhook_attempts (
 id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES cf_webhook_deliveries(id) ON DELETE CASCADE,
 attempted_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('sending','failed','delivered','uncertain')), http_status INTEGER
);
CREATE TRIGGER cf_webhook_enqueue AFTER INSERT ON cf_webhook_events BEGIN
 INSERT INTO cf_webhook_deliveries(id,subscription_id,event_id,status,next_at,created_at)
 SELECT lower(hex(randomblob(16))),s.id,NEW.id,'pending',NEW.occurred_at,NEW.occurred_at
 FROM cf_webhook_subscriptions s JOIN oa_operators o ON o.id=s.approved_by
 WHERE s.enabled=1 AND o.status='active' AND o.role IN ('owner','admin') AND o.version=s.approver_version
 AND EXISTS(SELECT 1 FROM json_each(s.events) WHERE value=NEW.event_type);
 DELETE FROM cf_webhook_events WHERE id=NEW.id AND NOT EXISTS(SELECT 1 FROM cf_webhook_deliveries WHERE event_id=NEW.id);
END;
CREATE TRIGGER cf_webhook_gift AFTER INSERT ON cf_gifts
WHEN (1=1) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),CASE WHEN NEW.kind='gift' THEN 'gift.created' ELSE 'gift.reversed' END,NEW.id,NEW.created_at); END;
CREATE TRIGGER cf_webhook_donor AFTER INSERT ON cf_donors
WHEN (NEW.erased_at IS NULL) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'donor.created',NEW.id,NEW.created_at); END;
CREATE TRIGGER cf_webhook_donor_update AFTER UPDATE ON cf_donors
WHEN (NEW.erased_at IS NULL AND NEW.version<>OLD.version) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'donor.updated',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER cf_webhook_plan_failure AFTER INSERT ON cf_recurring_payment_health
WHEN (NEW.failed_at IS NOT NULL) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'plan.failed',NEW.subscription_id,NEW.failed_at); END;
CREATE TRIGGER cf_webhook_plan_cancel AFTER UPDATE ON cf_subscriptions
WHEN ((NEW.cancel_at_period_end=1 AND OLD.cancel_at_period_end=0) OR (NEW.status='canceled' AND OLD.status<>'canceled' AND OLD.cancel_at_period_end=0)) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'plan.canceled',NEW.id,NEW.updated_at); END;
CREATE TRIGGER cf_webhook_task AFTER INSERT ON cf_call_tasks
WHEN (NEW.owner_id<>'') AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'task.assigned',NEW.id,NEW.created_at); END;
CREATE TRIGGER cf_webhook_task_update AFTER UPDATE OF owner_id ON cf_call_tasks
WHEN (NEW.owner_id<>OLD.owner_id) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'task.assigned',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER cf_webhook_form AFTER UPDATE OF session_id ON cf_giving_intents
WHEN (OLD.session_id IS NULL AND NEW.session_id IS NOT NULL) AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1)
BEGIN INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'form.submitted',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER cf_webhook_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_webhook_events WHERE subject_id=OLD.id
 OR subject_id IN (SELECT id FROM cf_gifts WHERE donor_id=OLD.id)
 OR subject_id IN (SELECT id FROM cf_subscriptions WHERE donor_id=OLD.id)
 OR subject_id IN (SELECT id FROM cf_giving_intents WHERE donor_id=OLD.id)
 OR subject_id IN (SELECT id FROM cf_call_tasks WHERE donor_id=OLD.id);
END;
CREATE TRIGGER cf_webhook_recurring_task AFTER INSERT ON cf_recurring_tasks
WHEN EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1) BEGIN
 INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'task.assigned',NEW.id,NEW.created_at);
END;
CREATE TRIGGER cf_webhook_grant_task AFTER INSERT ON cf_grant_tasks
WHEN EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1) BEGIN
 INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'task.assigned',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER cf_webhook_grant_task_update AFTER UPDATE OF owner_id ON cf_grant_tasks
WHEN NEW.owner_id<>OLD.owner_id AND EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE enabled=1) BEGIN
 INSERT INTO cf_webhook_events(id,event_type,subject_id,occurred_at) VALUES(lower(hex(randomblob(16))),'task.assigned',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER cf_webhook_call_task_removed BEFORE DELETE ON cf_call_tasks BEGIN
 DELETE FROM cf_webhook_events WHERE event_type='task.assigned' AND subject_id=OLD.id;
END;
CREATE TRIGGER cf_webhook_recurring_task_removed BEFORE DELETE ON cf_recurring_tasks BEGIN
 DELETE FROM cf_webhook_events WHERE event_type='task.assigned' AND subject_id=OLD.id;
END;
CREATE TRIGGER cf_webhook_grant_task_removed BEFORE DELETE ON cf_grant_tasks BEGIN
 DELETE FROM cf_webhook_events WHERE event_type='task.assigned' AND subject_id=OLD.id;
END;
