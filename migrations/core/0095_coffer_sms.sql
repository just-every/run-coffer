CREATE TABLE cf_sms_preferences (
 id INTEGER PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('granted','withdrawn')),
 phone TEXT NOT NULL,
 timezone TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('person','twilio-stop')),
 evidence TEXT NOT NULL,
 captured_on TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE INDEX cf_sms_preference_donor ON cf_sms_preferences(donor_id,id);
CREATE TABLE cf_sms_runs (
 id TEXT PRIMARY KEY,
 version INTEGER NOT NULL,
 name TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('appeal','thank-you','pledge-reminder')),
 body TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','approved')),
 excluded TEXT NOT NULL CHECK(json_valid(excluded)),
 prepared_at TEXT NOT NULL,
 prepared_by TEXT NOT NULL,
 approved_at TEXT,
 approved_by TEXT
);
CREATE TABLE cf_sms_recipients (
 run_id TEXT NOT NULL REFERENCES cf_sms_runs(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 phone TEXT NOT NULL,
 timezone TEXT NOT NULL,
 preference_id INTEGER NOT NULL,
 donor_version INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','held','submitting','submitted','failed','uncertain')),
 claimed_at TEXT,
 provider_id TEXT,
 provider_status TEXT,
 PRIMARY KEY(run_id,donor_id)
);
CREATE TABLE cf_sms_inbound (
 message_id TEXT PRIMARY KEY,
 received_at TEXT NOT NULL
);
CREATE TRIGGER cf_sms_preference_immutable BEFORE UPDATE ON cf_sms_preferences
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_PREFERENCE_IMMUTABLE'); END;
CREATE TRIGGER cf_sms_run_snapshot BEFORE UPDATE ON cf_sms_runs
WHEN NEW.id<>OLD.id OR NEW.name<>OLD.name OR NEW.purpose<>OLD.purpose OR NEW.body<>OLD.body
 OR NEW.excluded<>OLD.excluded OR NEW.prepared_at<>OLD.prepared_at OR NEW.prepared_by<>OLD.prepared_by
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER cf_sms_recipient_snapshot BEFORE UPDATE ON cf_sms_recipients
WHEN NEW.run_id<>OLD.run_id OR NEW.donor_id<>OLD.donor_id OR NEW.phone<>OLD.phone
 OR NEW.timezone<>OLD.timezone OR NEW.preference_id<>OLD.preference_id OR NEW.donor_version<>OLD.donor_version
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER cf_sms_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_sms_preferences WHERE donor_id=NEW.id;
 DELETE FROM cf_sms_recipients WHERE donor_id=NEW.id;
END;
CREATE TRIGGER cf_sms_merge_guard BEFORE INSERT ON cf_donor_merges
WHEN EXISTS(SELECT 1 FROM cf_sms_preferences WHERE donor_id IN (NEW.donor_id,NEW.into_id))
 OR EXISTS(SELECT 1 FROM cf_sms_recipients WHERE donor_id IN (NEW.donor_id,NEW.into_id))
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_MERGE_REVIEW'); END;
