CREATE TABLE cf_receipt_address_tasks (
 id TEXT PRIMARY KEY,
 letter_id TEXT NOT NULL UNIQUE REFERENCES cf_acks(id),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 completed_by TEXT,
 resolution TEXT
);
CREATE TRIGGER cf_receipt_task_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_receipt_address_tasks WHERE letter_id IN (SELECT id FROM cf_acks WHERE donor_id=NEW.id);
END;
INSERT OR IGNORE INTO cf_receipt_address_tasks(id,letter_id,created_at)
 SELECT 'receipt-address:'||a.id,a.id,min(e.recorded_at) FROM cf_acks a
 JOIN cf_letter_events e ON e.letter_id=a.id AND e.event='bounced'
 JOIN cf_donors d ON d.id=a.donor_id AND d.erased_at IS NULL GROUP BY a.id;

-- Existing scores retain their weights; provider opens are opt-in scoring.
ALTER TABLE cf_engagement_settings RENAME TO cf_engagement_settings_before_opens;
CREATE TABLE cf_engagement_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version>=2),
 recency INTEGER NOT NULL CHECK(recency BETWEEN 0 AND 100),
 frequency INTEGER NOT NULL CHECK(frequency BETWEEN 0 AND 100),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 100),
 conversations INTEGER NOT NULL CHECK(conversations BETWEEN 0 AND 100),
 volunteering INTEGER NOT NULL DEFAULT 0 CHECK(volunteering BETWEEN 0 AND 100),
 opens INTEGER NOT NULL DEFAULT 0 CHECK(opens BETWEEN 0 AND 100),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
 CHECK(recency+frequency+amount+conversations+volunteering+opens=100)
);
INSERT INTO cf_engagement_settings SELECT id,version,recency,frequency,amount,conversations,volunteering,0,updated_at,updated_by FROM cf_engagement_settings_before_opens;
DROP TABLE cf_engagement_settings_before_opens;
