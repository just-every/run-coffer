-- A constituent belongs to one portfolio; opportunities keep their own owners.
CREATE TABLE cf_portfolios (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 manager_id TEXT NOT NULL,
 untouched_days INTEGER NOT NULL CHECK(untouched_days BETWEEN 1 AND 3650),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE cf_portfolio_members (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id) ON DELETE CASCADE,
 portfolio_id TEXT NOT NULL REFERENCES cf_portfolios(id),
 assigned_on TEXT NOT NULL
);
CREATE INDEX cf_portfolio_members_portfolio ON cf_portfolio_members(portfolio_id);
ALTER TABLE cf_interactions ADD COLUMN recorded_by_id TEXT;
ALTER TABLE cf_interactions ADD COLUMN meaningful INTEGER NOT NULL DEFAULT 1 CHECK(meaningful IN (0,1));
-- Attribute old contacts from their actual audit event, never a display-name match.
UPDATE cf_interactions SET recorded_by_id=(SELECT actor_id FROM cf_events e
 WHERE (e.action='interaction.record' AND e.subject_id=cf_interactions.id)
 OR (e.action='task.complete' AND json_extract(e.detail,'$.interactionId')=cf_interactions.id)
 ORDER BY e.id DESC LIMIT 1);
UPDATE cf_interactions SET meaningful=0 WHERE EXISTS(SELECT 1 FROM cf_events e
 WHERE e.action='task.complete' AND json_extract(e.detail,'$.interactionId')=cf_interactions.id
 AND json_extract(e.detail,'$.outcome')<>'connected');
-- Keep existing prospects assigned, including installations with several owners.
INSERT INTO cf_portfolios(id,name,manager_id,untouched_days,created_at,updated_at)
 SELECT 'existing-'||p.owner_id,'Major gifts — '||COALESCE(o.display_name,'Reassignment needed'),p.owner_id,90,MIN(p.created_at),MAX(p.updated_at)
 FROM cf_prospects p LEFT JOIN oa_operators o ON o.id=p.owner_id GROUP BY p.owner_id;
INSERT INTO cf_portfolio_members(donor_id,portfolio_id,assigned_on)
 SELECT p.donor_id,'existing-'||p.owner_id,substr(p.created_at,1,10) FROM cf_prospects p
 WHERE p.id=(SELECT first.id FROM cf_prospects first WHERE first.donor_id=p.donor_id ORDER BY first.created_at,first.id LIMIT 1);
CREATE TRIGGER cf_portfolio_erasure AFTER UPDATE OF erased_at ON cf_donors
 WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
 BEGIN DELETE FROM cf_portfolio_members WHERE donor_id=NEW.id; END;
