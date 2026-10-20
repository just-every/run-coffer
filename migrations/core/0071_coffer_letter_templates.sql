-- RCPT-007: reviewed thank-you templates by kind; every letter records the template version it used.
CREATE TABLE cf_letter_templates (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('campaign','tribute','major_gift','first_gift','recurring_start','in_kind','year_end')),
 campaign_id TEXT REFERENCES cf_campaigns(id),
 min_cents INTEGER CHECK(min_cents IS NULL OR min_cents>0),
 name TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 reviewed_at TEXT NOT NULL,
 reviewed_by TEXT NOT NULL,
 CHECK((kind='campaign')=(campaign_id IS NOT NULL)),
 CHECK((kind='major_gift')=(min_cents IS NOT NULL))
);
CREATE UNIQUE INDEX cf_letter_template_active ON cf_letter_templates(kind,COALESCE(campaign_id,'')) WHERE active=1;
CREATE TABLE cf_letter_template_versions (
 template_id TEXT NOT NULL REFERENCES cf_letter_templates(id),
 version INTEGER NOT NULL,
 active INTEGER NOT NULL,
 min_cents INTEGER,
 name TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 saved_at TEXT NOT NULL,
 saved_by TEXT NOT NULL,
 PRIMARY KEY(template_id,version)
);
ALTER TABLE cf_acks ADD COLUMN template_kind TEXT;
ALTER TABLE cf_acks ADD COLUMN template_id TEXT;
ALTER TABLE cf_acks ADD COLUMN template_version INTEGER;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN template_kind TEXT;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN template_id TEXT;
ALTER TABLE cf_in_kind_acknowledgments ADD COLUMN template_version INTEGER;
