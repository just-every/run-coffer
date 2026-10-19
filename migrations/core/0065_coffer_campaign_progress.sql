-- CAMP-001: nested campaigns retain their own goals, funds and giving forms.
ALTER TABLE cf_campaigns ADD COLUMN starts_on TEXT;
ALTER TABLE cf_campaigns ADD COLUMN ends_on TEXT;
ALTER TABLE cf_campaigns ADD COLUMN parent_id TEXT REFERENCES cf_campaigns(id);
ALTER TABLE cf_pledges ADD COLUMN campaign_id TEXT REFERENCES cf_campaigns(id);
CREATE INDEX cf_campaign_parent ON cf_campaigns(parent_id);
CREATE INDEX cf_pledge_campaign ON cf_pledges(campaign_id);
CREATE TABLE cf_campaign_appeals (
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id) ON DELETE CASCADE,
 appeal TEXT NOT NULL COLLATE NOCASE REFERENCES cf_appeal_codes(code),
 PRIMARY KEY(campaign_id,appeal)
);
