CREATE TABLE cf_volunteering (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 role TEXT NOT NULL,
 occurred_on TEXT NOT NULL,
 minutes INTEGER NOT NULL CHECK(minutes>0 AND minutes<=1440),
 source TEXT NOT NULL,
 source_key TEXT,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL,
 UNIQUE(source,source_key)
);
CREATE INDEX cf_volunteering_donor ON cf_volunteering(donor_id,occurred_on);
CREATE TRIGGER cf_volunteering_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_volunteering WHERE donor_id=NEW.id; END;
-- Preserve existing settings and scores while adding an opt-in activity weight.
ALTER TABLE cf_engagement_settings RENAME TO cf_engagement_settings_previous;
CREATE TABLE cf_engagement_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version>=2),
 recency INTEGER NOT NULL CHECK(recency BETWEEN 0 AND 100),
 frequency INTEGER NOT NULL CHECK(frequency BETWEEN 0 AND 100),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 100),
 conversations INTEGER NOT NULL CHECK(conversations BETWEEN 0 AND 100),
 volunteering INTEGER NOT NULL DEFAULT 0 CHECK(volunteering BETWEEN 0 AND 100),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
 CHECK(recency+frequency+amount+conversations+volunteering=100)
);
INSERT INTO cf_engagement_settings SELECT id,version,recency,frequency,amount,conversations,0,updated_at,updated_by FROM cf_engagement_settings_previous;
DROP TABLE cf_engagement_settings_previous;
