CREATE TABLE cf_giving_attempt_windows (campaign_id TEXT PRIMARY KEY REFERENCES cf_campaigns(id), minute INTEGER NOT NULL, attempts INTEGER NOT NULL, failures INTEGER NOT NULL, paused INTEGER NOT NULL DEFAULT 0, alerted_at TEXT);
CREATE TABLE cf_giving_fraud_events (event_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id), created_at TEXT NOT NULL);
