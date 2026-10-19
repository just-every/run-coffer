CREATE TABLE cf_cultivation_templates (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, steps TEXT NOT NULL CHECK(json_valid(steps)),
 version INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE cf_cultivation_tasks (
 id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES cf_prospects(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL, template_id TEXT NOT NULL, template_name TEXT NOT NULL, title TEXT NOT NULL,
 due_on TEXT NOT NULL, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','done')),
 version INTEGER NOT NULL, completed_on TEXT, notes TEXT, created_at TEXT NOT NULL
);
CREATE INDEX cf_cultivation_tasks_prospect ON cf_cultivation_tasks(prospect_id,due_on);
CREATE TABLE cf_proposals (
 id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES cf_prospects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
 file_name TEXT, media_type TEXT, content_base64 TEXT, sent_on TEXT, sent_method TEXT, sent_evidence TEXT,
 response_on TEXT, response TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX cf_proposals_prospect ON cf_proposals(prospect_id);
