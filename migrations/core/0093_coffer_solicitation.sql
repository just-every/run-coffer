-- One current answer plus immutable, versioned history. Dates are inclusive,
-- organization-local calendar dates; limits reset on January 1 across channels.
CREATE TABLE cf_solicitation (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>0),
 type TEXT NOT NULL CHECK(type IN ('none','stop','channels','limit')),
 starts_on TEXT NOT NULL,
 ends_on TEXT,
 channels TEXT NOT NULL CHECK(json_valid(channels)),
 max_asks INTEGER CHECK(max_asks>0),
 source TEXT NOT NULL CHECK(source IN ('person','portal','interaction','import')),
 source_ref TEXT,
 source_on TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by_id TEXT NOT NULL,
 recorded_by_name TEXT NOT NULL,
 CHECK(ends_on IS NULL OR ends_on>=starts_on),
 CHECK((type='limit' AND max_asks IS NOT NULL) OR (type<>'limit' AND max_asks IS NULL))
);
CREATE TABLE cf_solicitation_history (
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 answer TEXT NOT NULL CHECK(json_valid(answer)),
 PRIMARY KEY(donor_id,version)
);
CREATE TABLE cf_solicitation_runs (
 kind TEXT NOT NULL,
 run_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('email','mail','sms','phone')),
 is_ask INTEGER NOT NULL CHECK(is_ask IN (0,1)),
 prepared_at TEXT NOT NULL,
 PRIMARY KEY(kind,run_id)
);
CREATE TABLE cf_solicitation_recipients (
 kind TEXT NOT NULL,
 run_id TEXT NOT NULL,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 restriction_version INTEGER NOT NULL,
 PRIMARY KEY(kind,run_id,donor_id),
 FOREIGN KEY(kind,run_id) REFERENCES cf_solicitation_runs(kind,run_id) ON DELETE CASCADE
);
CREATE TABLE cf_solicitation_inclusions (
 kind TEXT NOT NULL,
 run_id TEXT NOT NULL,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 restriction_version INTEGER NOT NULL,
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(kind,run_id,donor_id),
 FOREIGN KEY(kind,run_id) REFERENCES cf_solicitation_runs(kind,run_id) ON DELETE CASCADE
);
CREATE TABLE cf_solicitation_asks (
 kind TEXT NOT NULL,
 run_id TEXT NOT NULL,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('email','mail','sms','phone')),
 asked_on TEXT NOT NULL,
 submitted_at TEXT NOT NULL,
 PRIMARY KEY(kind,run_id,donor_id)
);
CREATE INDEX cf_solicitation_asks_period ON cf_solicitation_asks(donor_id,asked_on);
CREATE TRIGGER cf_solicitation_history_immutable BEFORE UPDATE ON cf_solicitation_history
BEGIN SELECT RAISE(ABORT,'COFFER_SOLICITATION_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER cf_solicitation_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_solicitation WHERE donor_id=NEW.id;
 DELETE FROM cf_solicitation_history WHERE donor_id=NEW.id;
 DELETE FROM cf_solicitation_recipients WHERE donor_id=NEW.id;
 DELETE FROM cf_solicitation_inclusions WHERE donor_id=NEW.id;
 DELETE FROM cf_solicitation_asks WHERE donor_id=NEW.id;
END;
-- Classify existing email/mail runs and freeze their then-current unrestricted state.
INSERT INTO cf_solicitation_runs SELECT 'appeal',id,channel,1,prepared_at FROM cf_appeals;
INSERT INTO cf_solicitation_recipients SELECT 'appeal',appeal_id,donor_id,0 FROM cf_appeal_recipients;
INSERT INTO cf_solicitation_asks SELECT 'appeal',r.appeal_id,r.donor_id,a.channel,substr(COALESCE(a.sent_on,a.exported_at),1,10),COALESCE(a.exported_at,a.prepared_at)
 FROM cf_appeal_recipients r JOIN cf_appeals a ON a.id=r.appeal_id WHERE a.status IN ('exported','sent');
