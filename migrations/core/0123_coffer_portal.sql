-- Portal sessions bind the emailed identity; existing outstanding links expire closed.
ALTER TABLE cf_donor_tokens ADD COLUMN email_hash TEXT;
CREATE TABLE cf_annual_preparations(year INTEGER PRIMARY KEY,batch_id TEXT NOT NULL,prepared_at TEXT NOT NULL);
CREATE TABLE cf_annual_holds(year INTEGER PRIMARY KEY,checked_on TEXT NOT NULL,reason TEXT NOT NULL);
-- Only opaque provider references and donor-confirmed operational facts are retained.
CREATE TABLE cf_portal_changes(
 id TEXT PRIMARY KEY,donor_id TEXT NOT NULL REFERENCES cf_donors(id),subscription_id TEXT REFERENCES cf_subscriptions(id),
 action TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','complete','uncertain')),
 request TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT
);
CREATE UNIQUE INDEX cf_portal_subscription_pending ON cf_portal_changes(subscription_id) WHERE state='pending';
CREATE TABLE cf_portal_subscription_settings(
 subscription_id TEXT PRIMARY KEY REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 interval TEXT NOT NULL,interval_count INTEGER NOT NULL,collection_paused INTEGER NOT NULL DEFAULT 0,
 observed_at TEXT NOT NULL
);
CREATE TABLE cf_portal_copies(
 id TEXT PRIMARY KEY,donor_id TEXT NOT NULL REFERENCES cf_donors(id),letter_id TEXT NOT NULL REFERENCES cf_acks(id),
 state TEXT NOT NULL CHECK(state IN ('sending','submitted','uncertain','rejected')),message_id TEXT,requested_at TEXT NOT NULL
);
CREATE TRIGGER cf_portal_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_donor_tokens WHERE donor_id=NEW.id;
 DELETE FROM cf_portal_changes WHERE donor_id=NEW.id;
 DELETE FROM cf_portal_copies WHERE donor_id=NEW.id;
 DELETE FROM cf_portal_subscription_settings WHERE subscription_id IN (SELECT id FROM cf_subscriptions WHERE donor_id=NEW.id);
END;

CREATE TRIGGER cf_portal_merged_identity AFTER INSERT ON cf_donor_merges BEGIN
 DELETE FROM cf_donor_tokens WHERE donor_id=NEW.donor_id;
 DELETE FROM cf_portal_changes WHERE donor_id=NEW.donor_id AND action='card';
END;
ALTER TABLE cf_portal_copies ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE cf_portal_copies ADD COLUMN delivered_at TEXT;
CREATE TABLE cf_portal_copy_events(
 id TEXT PRIMARY KEY,copy_id TEXT NOT NULL REFERENCES cf_portal_copies(id) ON DELETE CASCADE,
 event TEXT NOT NULL CHECK(event IN ('delivered','bounced','complained','opened')),
 occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,signature_verified INTEGER NOT NULL CHECK(signature_verified=1)
);
