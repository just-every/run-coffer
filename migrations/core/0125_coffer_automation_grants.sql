-- These grants describe existing deterministic background capabilities. No new
-- outbound capability is enabled: receipts still prepare for human approval.
CREATE TABLE cf_automation_grants (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 donor_ids TEXT CHECK(donor_ids IS NULL OR json_valid(donor_ids)),
 commands TEXT NOT NULL CHECK(json_valid(commands)),
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 10000)
);
INSERT INTO cf_automation_grants(id,name,commands,daily_limit) VALUES
 ('reconciliation','Scheduled giving reconciliation','["reconciliation.run"]',100),
 ('recovery','Existing recurring-payment notices','["recovery.observe","recovery.notice","recovery.expiry","recovery.task"]',1000),
 ('receipts','Scheduled missing-receipt preparation','["receipts.prepare"]',500),
 ('briefs','Scheduled meeting readiness','["briefs.prepare"]',1000);
CREATE TABLE cf_automation_usage (
 grant_id TEXT NOT NULL REFERENCES cf_automation_grants(id), day TEXT NOT NULL,
 reserved INTEGER NOT NULL, PRIMARY KEY(grant_id,day)
);
ALTER TABLE cf_agent_recovery ADD COLUMN notice_claim_id TEXT;
