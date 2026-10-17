CREATE TABLE cf_agent_activity (
 id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 kind TEXT NOT NULL, subject_id TEXT NOT NULL, summary TEXT NOT NULL, why TEXT NOT NULL,
 undo_kind TEXT, undo_data TEXT, undone_at TEXT
);
CREATE TABLE cf_agent_issues (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
 summary TEXT NOT NULL, why TEXT NOT NULL, evidence TEXT NOT NULL, proposed TEXT NOT NULL,
 fingerprint TEXT NOT NULL, found_at TEXT NOT NULL, applied_at TEXT, activity_id TEXT
);
CREATE UNIQUE INDEX cf_agent_open_issue ON cf_agent_issues(source_id,kind) WHERE state='open';
CREATE TABLE cf_agent_runs (job TEXT PRIMARY KEY, at TEXT NOT NULL, summary TEXT NOT NULL);
