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
 state TEXT NOT NULL CHECK(state IN ('prepared','approved','discarded','redacted')),
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
 state TEXT NOT NULL CHECK(state IN ('pending','held','submitting','submitted','failed','uncertain','cancelled')),
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
WHEN ((NEW.id<>OLD.id OR NEW.name<>OLD.name OR NEW.purpose<>OLD.purpose OR NEW.body<>OLD.body
 OR NEW.excluded<>OLD.excluded OR NEW.prepared_at<>OLD.prepared_at OR NEW.prepared_by<>OLD.prepared_by)
 AND NOT (NEW.id=OLD.id AND NEW.purpose=OLD.purpose AND NEW.prepared_at=OLD.prepared_at AND NEW.prepared_by=OLD.prepared_by
  AND NEW.state='redacted' AND NEW.name='Erased text run' AND NEW.body='[redacted]' AND NEW.excluded='[]'
  AND (EXISTS(SELECT 1 FROM cf_sms_recipients r JOIN cf_donors d ON d.id=r.donor_id WHERE r.run_id=OLD.id AND d.erased_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM json_each(OLD.excluded) x JOIN cf_donors d ON d.id=json_extract(x.value,'$.donorId') WHERE d.erased_at IS NOT NULL))))
 OR (OLD.state='redacted' AND NEW.state<>'redacted')
 OR (OLD.state='discarded' AND NEW.state NOT IN ('discarded','redacted'))
 OR (NEW.state='discarded' AND EXISTS(SELECT 1 FROM cf_sms_recipients WHERE run_id=OLD.id AND claimed_at IS NOT NULL))
 OR (NEW.state='redacted' AND (NEW.name<>'Erased text run' OR NEW.body<>'[redacted]' OR NEW.excluded<>'[]'))
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER cf_sms_run_cancel AFTER UPDATE OF state ON cf_sms_runs
WHEN NEW.state='redacted' BEGIN
 UPDATE cf_sms_recipients SET state='cancelled' WHERE run_id=NEW.id AND state IN ('pending','held');
END;
CREATE TRIGGER cf_sms_recipient_snapshot BEFORE UPDATE ON cf_sms_recipients
WHEN NEW.run_id<>OLD.run_id OR NEW.donor_id<>OLD.donor_id OR NEW.phone<>OLD.phone
 OR NEW.timezone<>OLD.timezone OR NEW.preference_id<>OLD.preference_id OR NEW.donor_version<>OLD.donor_version
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER cf_sms_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL BEGIN
 -- A shared body/name can itself identify the erased person. Redact the entire
 -- run, not merely their address, and terminate all remaining pending work.
 UPDATE cf_sms_runs SET state='redacted',version=version+1,name='Erased text run',body='[redacted]',excluded='[]'
 WHERE id IN (SELECT run_id FROM cf_sms_recipients WHERE donor_id=NEW.id)
  OR EXISTS(SELECT 1 FROM json_each(cf_sms_runs.excluded) x WHERE json_extract(x.value,'$.donorId')=NEW.id);
 DELETE FROM cf_sms_preferences WHERE donor_id=NEW.id;
 DELETE FROM cf_sms_recipients WHERE donor_id=NEW.id;
END;
CREATE TRIGGER cf_sms_merge_guard BEFORE INSERT ON cf_donor_merges
WHEN EXISTS(SELECT 1 FROM cf_sms_recipients r JOIN cf_sms_runs u ON u.id=r.run_id
 WHERE u.state IN ('prepared','approved') AND r.state IN ('pending','held','submitting') AND
 r.donor_id IN (SELECT NEW.donor_id UNION SELECT NEW.into_id UNION SELECT donor_id FROM cf_donor_merges WHERE into_id IN (NEW.donor_id,NEW.into_id)))
BEGIN SELECT RAISE(ABORT,'COFFER_SMS_MERGE_REVIEW'); END;
