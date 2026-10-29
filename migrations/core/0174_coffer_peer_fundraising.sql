-- Supporter fundraising attribution is separate from gifts and cash totals.
CREATE TABLE cf_peer_teams (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 goal_cents INTEGER NOT NULL CHECK(typeof(goal_cents)='integer' AND goal_cents>0),
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL
);
CREATE INDEX cf_peer_team_owner ON cf_peer_teams(donor_id);
CREATE INDEX cf_peer_team_campaign ON cf_peer_teams(campaign_id,published);
CREATE TABLE cf_peer_pages (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 team_id TEXT REFERENCES cf_peer_teams(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 goal_cents INTEGER NOT NULL CHECK(typeof(goal_cents)='integer' AND goal_cents>0),
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL
);
CREATE INDEX cf_peer_page_owner ON cf_peer_pages(donor_id);
CREATE INDEX cf_peer_page_campaign ON cf_peer_pages(campaign_id,published);
CREATE INDEX cf_peer_page_team ON cf_peer_pages(team_id);
CREATE TABLE cf_peer_intents (
 intent_id TEXT PRIMARY KEY REFERENCES cf_giving_intents(id) ON DELETE CASCADE,
 page_id TEXT NOT NULL REFERENCES cf_peer_pages(id)
);
CREATE TABLE cf_peer_gifts (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 page_id TEXT NOT NULL REFERENCES cf_peer_pages(id)
);
CREATE INDEX cf_peer_gift_page ON cf_peer_gifts(page_id);
CREATE TRIGGER cf_peer_page_campaign BEFORE UPDATE OF id,campaign_id ON cf_peer_pages
WHEN NEW.id IS NOT OLD.id OR NEW.campaign_id IS NOT OLD.campaign_id
BEGIN SELECT RAISE(ABORT,'COFFER_PEER_IDENTITY'); END;
CREATE TRIGGER cf_peer_team_campaign BEFORE UPDATE OF id,campaign_id ON cf_peer_teams
WHEN NEW.id IS NOT OLD.id OR NEW.campaign_id IS NOT OLD.campaign_id
BEGIN SELECT RAISE(ABORT,'COFFER_PEER_IDENTITY'); END;
CREATE TRIGGER cf_peer_page_team_insert BEFORE INSERT ON cf_peer_pages
WHEN NEW.team_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_peer_teams WHERE id=NEW.team_id AND campaign_id=NEW.campaign_id)
BEGIN SELECT RAISE(ABORT,'COFFER_PEER_TEAM'); END;
CREATE TRIGGER cf_peer_page_team_update BEFORE UPDATE OF team_id ON cf_peer_pages
WHEN NEW.team_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_peer_teams WHERE id=NEW.team_id AND campaign_id=NEW.campaign_id)
BEGIN SELECT RAISE(ABORT,'COFFER_PEER_TEAM'); END;
CREATE TRIGGER cf_peer_intent_immutable BEFORE UPDATE ON cf_peer_intents
BEGIN SELECT RAISE(ABORT,'COFFER_PEER_INTENT_IMMUTABLE'); END;
CREATE TRIGGER cf_peer_gift_immutable BEFORE UPDATE ON cf_peer_gifts
BEGIN SELECT RAISE(ABORT,'COFFER_PEER_GIFT_IMMUTABLE'); END;
-- Redact before native erasure moves financial ownership to its placeholder.
-- Keep checkout attribution tombstones so replay cannot change the source.
CREATE TRIGGER cf_peer_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_peer_pages SET title='[erased]',published=0,version=version+1 WHERE donor_id=NEW.id;
 UPDATE cf_peer_teams SET title='[erased]',published=0,version=version+1 WHERE donor_id=NEW.id;
END;
