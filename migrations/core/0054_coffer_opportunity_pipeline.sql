-- Stages are organization settings; opportunity data stays on its existing
-- donor-owned row, covered by erasure, merge journals and portable archives.
ALTER TABLE cf_settings ADD COLUMN opportunity_stages TEXT NOT NULL DEFAULT '[{"id":"identify","label":"Identify","outcome":"open"},{"id":"qualify","label":"Qualify","outcome":"open"},{"id":"cultivate","label":"Cultivate","outcome":"open"},{"id":"ask","label":"Ask","outcome":"open"},{"id":"stewardship","label":"Stewardship","outcome":"open"},{"id":"closed_won","label":"Closed won","outcome":"won"},{"id":"closed_lost","label":"Closed lost","outcome":"lost"}]' CHECK(json_valid(opportunity_stages));
ALTER TABLE cf_settings ADD COLUMN opportunity_stages_version INTEGER NOT NULL DEFAULT 1 CHECK(opportunity_stages_version>0);

-- Remove the old fixed-stage CHECK. Preserve children explicitly because their
-- ON DELETE CASCADE applies even during SQLite's deferred parent replacement.
PRAGMA defer_foreign_keys = on;
CREATE TABLE cf_opportunity_migration_tasks AS SELECT * FROM cf_cultivation_tasks;
CREATE TABLE cf_opportunity_migration_proposals AS SELECT * FROM cf_proposals;
DROP TRIGGER cf_major_gift_erasure;
CREATE TABLE cf_prospects_next (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 stage TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 ask_amount_cents INTEGER NOT NULL CHECK(typeof(ask_amount_cents)='integer' AND ask_amount_cents BETWEEN 0 AND 10000000000),
 expected_close_on TEXT NOT NULL,
 next_step TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 expected_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(expected_amount_cents)='integer' AND expected_amount_cents BETWEEN 0 AND 10000000000),
 probability_percent INTEGER NOT NULL DEFAULT 100 CHECK(typeof(probability_percent)='integer' AND probability_percent BETWEEN 0 AND 100),
 fund TEXT NOT NULL DEFAULT 'Unrestricted',
 campaign_id TEXT REFERENCES cf_campaigns(id),
 pledge_id TEXT REFERENCES cf_pledges(id),
 gift_id TEXT REFERENCES cf_gifts(id),
 closed_on TEXT,
 CHECK(pledge_id IS NULL OR gift_id IS NULL),
 CHECK(closed_on IS NOT NULL OR (pledge_id IS NULL AND gift_id IS NULL))
);
INSERT INTO cf_prospects_next(id,donor_id,label,stage,owner_id,ask_amount_cents,expected_close_on,next_step,version,created_at,created_by,updated_at,updated_by,expected_amount_cents)
 SELECT id,donor_id,label,stage,owner_id,ask_amount_cents,expected_close_on,next_step,version,created_at,created_by,updated_at,updated_by,ask_amount_cents FROM cf_prospects;
DROP TABLE cf_prospects;
ALTER TABLE cf_prospects_next RENAME TO cf_prospects;
INSERT INTO cf_cultivation_tasks SELECT * FROM cf_opportunity_migration_tasks;
INSERT INTO cf_proposals SELECT * FROM cf_opportunity_migration_proposals;
DROP TABLE cf_opportunity_migration_tasks;
DROP TABLE cf_opportunity_migration_proposals;
CREATE INDEX cf_prospect_donor ON cf_prospects(donor_id);
CREATE INDEX cf_prospect_stage_owner ON cf_prospects(stage,owner_id,expected_close_on);
CREATE INDEX cf_prospect_campaign ON cf_prospects(campaign_id,stage);
CREATE UNIQUE INDEX cf_prospect_pledge ON cf_prospects(pledge_id) WHERE pledge_id IS NOT NULL;
CREATE UNIQUE INDEX cf_prospect_gift ON cf_prospects(gift_id) WHERE gift_id IS NOT NULL;
CREATE TRIGGER cf_major_gift_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_prospects WHERE donor_id=NEW.id;
END;
INSERT INTO cf_assert(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
DELETE FROM cf_assert;
PRAGMA defer_foreign_keys = off;
