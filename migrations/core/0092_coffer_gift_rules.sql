CREATE TABLE cf_gift_rules (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('amount_call','first_tag','fund_notify')),
 minimum_cents INTEGER, owner_id TEXT, tag TEXT, fund TEXT, provider TEXT CHECK(provider IS NULL OR provider='slack'),
 published_at TEXT, published_by TEXT, created_at TEXT NOT NULL,
 CHECK((kind='fund_notify' AND provider='slack') OR (kind<>'fund_notify' AND provider IS NULL))
);
CREATE TABLE cf_gift_rule_versions (
 rule_id TEXT NOT NULL REFERENCES cf_gift_rules(id), version INTEGER NOT NULL,
 snapshot TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL,
 PRIMARY KEY(rule_id,version)
);
-- One arrival assessment, including when no rule matched. Later publication
-- never retroactively enrolls history and two payment doors share this fence.
CREATE TABLE cf_gift_rule_arrivals (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id), token TEXT NOT NULL, assessed_at TEXT NOT NULL
);
CREATE TABLE cf_gift_rule_firings (
 rule_id TEXT NOT NULL REFERENCES cf_gift_rules(id), gift_id TEXT NOT NULL REFERENCES cf_gifts(id),
 rule_version INTEGER NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
 task_id TEXT, due_at TEXT, created_at TEXT NOT NULL, completed_at TEXT,
 PRIMARY KEY(rule_id,gift_id)
);
CREATE TABLE cf_donor_rule_tags (
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE, tag TEXT NOT NULL,
 rule_id TEXT NOT NULL REFERENCES cf_gift_rules(id), gift_id TEXT NOT NULL REFERENCES cf_gifts(id), created_at TEXT NOT NULL,
 PRIMARY KEY(donor_id,tag)
);
CREATE TRIGGER cf_gift_rule_tag_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_donor_rule_tags WHERE donor_id=NEW.id; END;
