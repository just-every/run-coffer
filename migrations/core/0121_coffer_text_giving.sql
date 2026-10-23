CREATE TABLE cf_giving_connections (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE cf_text_keywords (keyword TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id), appeal TEXT REFERENCES cf_appeal_codes(code), created_at TEXT NOT NULL);
CREATE TABLE cf_text_stops (phone_hash TEXT PRIMARY KEY, stopped_at TEXT NOT NULL);
ALTER TABLE cf_giving_intents ADD COLUMN giving_channel TEXT NOT NULL DEFAULT 'form' CHECK(giving_channel IN ('form','text'));
