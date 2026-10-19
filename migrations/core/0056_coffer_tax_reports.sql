-- Working-paper selection only: eligibility and return preparation remain with
-- the organization's accountant. Keep this versioned setting in backups.
CREATE TABLE cf_tax_report_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL CHECK(version>0),
 schedule_b_rule TEXT NOT NULL CHECK(schedule_b_rule IN ('general','public_support')),
 denominator_start TEXT,
 denominator_through TEXT,
 denominator_cents INTEGER CHECK(denominator_cents>=0),
 updated_at TEXT,
 updated_by TEXT
);
INSERT INTO cf_tax_report_settings(id,version,schedule_b_rule) VALUES(1,1,'general');
