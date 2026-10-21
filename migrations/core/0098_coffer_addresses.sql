CREATE TABLE cf_address_processing (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), paf_reference TEXT,
 reviewed_at TEXT NOT NULL, reviewed_by TEXT NOT NULL
);
CREATE TABLE cf_address_checks (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id), version INTEGER NOT NULL,
 fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('verified','unverified','undeliverable','error')),
 reason TEXT NOT NULL, codes TEXT NOT NULL, checked_at TEXT NOT NULL, source TEXT NOT NULL,
 move_effective_month TEXT
);
CREATE TABLE cf_ncoa_runs (
 id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN('queued','processing','completed','failed','uncertain','cancelled')),
 total INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 completed_at TEXT, claimed_at TEXT, reason TEXT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 connection_version INTEGER NOT NULL, consumed_appeal_id TEXT REFERENCES cf_appeals(id)
);
CREATE TABLE cf_ncoa_members (
 run_id TEXT NOT NULL REFERENCES cf_ncoa_runs(id), donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 fingerprint TEXT NOT NULL, ordinal INTEGER NOT NULL, processed_at TEXT, result TEXT,
 PRIMARY KEY(run_id,donor_id)
);
CREATE INDEX cf_ncoa_members_donor ON cf_ncoa_members(donor_id);
CREATE TABLE cf_mail_address_snapshots (
 appeal_id TEXT NOT NULL REFERENCES cf_appeals(id), donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 fingerprint TEXT NOT NULL, check_version INTEGER NOT NULL, ncoa_run_id TEXT NOT NULL REFERENCES cf_ncoa_runs(id),
 PRIMARY KEY(appeal_id,donor_id)
);
CREATE TRIGGER cf_address_checks_erasure AFTER UPDATE OF erased_at ON cf_donors WHEN NEW.erased_at IS NOT NULL BEGIN
 UPDATE cf_ncoa_runs SET state='cancelled',reason='A donor was erased; prepare a new pass.' WHERE state IN('queued','processing') AND id IN(SELECT run_id FROM cf_ncoa_members WHERE donor_id=NEW.id);
 DELETE FROM cf_address_checks WHERE donor_id=NEW.id;
 DELETE FROM cf_ncoa_members WHERE donor_id=NEW.id;
 DELETE FROM cf_mail_address_snapshots WHERE donor_id=NEW.id;
END;

CREATE TRIGGER cf_address_check_changed AFTER UPDATE OF name,constituent_kind,address_line1,address_line2,city,region,postal_code,country ON cf_donors
WHEN OLD.name IS NOT NEW.name OR OLD.constituent_kind IS NOT NEW.constituent_kind OR OLD.address_line1 IS NOT NEW.address_line1 OR OLD.address_line2 IS NOT NEW.address_line2 OR OLD.city IS NOT NEW.city OR OLD.region IS NOT NEW.region OR OLD.postal_code IS NOT NEW.postal_code OR OLD.country IS NOT NEW.country
BEGIN
 UPDATE cf_address_checks SET version=version+1,fingerprint='invalidated:'||NEW.version,status='unverified',reason='address_changed' WHERE donor_id=NEW.id;
END;
