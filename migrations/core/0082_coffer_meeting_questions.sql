-- DEV-006: a question belongs to its source meeting interaction and shares custody.
ALTER TABLE cf_interactions ADD COLUMN open_question TEXT;
ALTER TABLE cf_interactions ADD COLUMN question_resolved_at TEXT;
ALTER TABLE cf_interactions ADD COLUMN question_version INTEGER NOT NULL DEFAULT 1 CHECK(question_version>0);
