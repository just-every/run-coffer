ALTER TABLE cf_settings ADD COLUMN call_outcome_days INTEGER NOT NULL DEFAULT 90 CHECK(call_outcome_days BETWEEN 1 AND 3650);
ALTER TABLE cf_settings ADD COLUMN call_rank_policy_version INTEGER NOT NULL DEFAULT 1 CHECK(call_rank_policy_version>=1);

-- Operator identities belong to installation auth, which is not archived.
CREATE TABLE cf_call_rank_runs (
 id TEXT PRIMARY KEY,
 week_on TEXT NOT NULL,
 manager_id TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity BETWEEN 0 AND 1000),
 window_days INTEGER NOT NULL CHECK(window_days BETWEEN 1 AND 3650),
 fiscal_year INTEGER NOT NULL,
 fiscal_start TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 excluded TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(excluded)),
 UNIQUE(manager_id,week_on)
);
CREATE TABLE cf_call_rank_entries (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES cf_call_rank_runs(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 rank_num INTEGER NOT NULL CHECK(rank_num>=1),
 score INTEGER NOT NULL CHECK(score>=0),
 is_ask INTEGER NOT NULL CHECK(is_ask IN (0,1)),
 reason TEXT NOT NULL,
 task_id TEXT REFERENCES cf_call_tasks(id) ON DELETE SET NULL,
 state TEXT NOT NULL CHECK(state IN ('task','overflow','held')),
 created_at TEXT NOT NULL,
 facts TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(facts)),
 UNIQUE(run_id,donor_id),
 UNIQUE(run_id,rank_num)
);
CREATE INDEX cf_call_rank_manager ON cf_call_rank_runs(manager_id,week_on);
CREATE INDEX cf_call_rank_donor ON cf_call_rank_entries(donor_id,run_id);
CREATE TRIGGER cf_call_rank_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_call_rank_entries WHERE donor_id=NEW.id OR donor_id IN (SELECT donor_id FROM cf_donor_merges WHERE into_id=NEW.id); END;

INSERT INTO cf_automation_grants(id,name,enabled,commands,daily_limit) VALUES('calls','Weekly call priorities',0,'["calls.rank"]',1000);
