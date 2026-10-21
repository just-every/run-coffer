-- Rebuild both sides of the template-history foreign key. Existing reviewed
-- wording, versions and document metadata keep their identities unchanged.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE cf_letter_templates_next (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('campaign','tribute','major_gift','first_gift','recurring_start','in_kind','year_end','stock','daf','qcd')),
 campaign_id TEXT REFERENCES cf_campaigns(id),
 min_cents INTEGER CHECK(min_cents IS NULL OR min_cents>0),
 name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 reviewed_at TEXT NOT NULL, reviewed_by TEXT NOT NULL,
 CHECK((kind='campaign')=(campaign_id IS NOT NULL)),
 CHECK((kind='major_gift')=(min_cents IS NOT NULL))
);
INSERT INTO cf_letter_templates_next SELECT * FROM cf_letter_templates;
CREATE TABLE cf_letter_template_versions_next (
 template_id TEXT NOT NULL REFERENCES cf_letter_templates_next(id),
 version INTEGER NOT NULL, active INTEGER NOT NULL, min_cents INTEGER,
 name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 saved_at TEXT NOT NULL, saved_by TEXT NOT NULL,
 PRIMARY KEY(template_id,version)
);
INSERT INTO cf_letter_template_versions_next SELECT * FROM cf_letter_template_versions;
DROP TABLE cf_letter_template_versions;
DROP TABLE cf_letter_templates;
ALTER TABLE cf_letter_templates_next RENAME TO cf_letter_templates;
ALTER TABLE cf_letter_template_versions_next RENAME TO cf_letter_template_versions;
CREATE UNIQUE INDEX cf_letter_template_active ON cf_letter_templates(kind,COALESCE(campaign_id,'')) WHERE active=1;
PRAGMA defer_foreign_keys=OFF;
