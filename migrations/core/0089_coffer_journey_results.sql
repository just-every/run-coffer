-- Existing publications and enrolled steps deliberately remain unbound.
CREATE TABLE cf_journey_step_publications (
 code TEXT PRIMARY KEY COLLATE NOCASE REFERENCES cf_appeal_codes(code),
 publication_id TEXT NOT NULL,
 step TEXT NOT NULL CHECK(step IN ('thank','impact','ask')),
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 list_name TEXT NOT NULL UNIQUE,
 published_at TEXT NOT NULL,
 UNIQUE(publication_id,step)
);
CREATE TRIGGER cf_journey_publication_immutable BEFORE UPDATE ON cf_journey_step_publications
BEGIN SELECT RAISE(ABORT,'COFFER_JOURNEY_PUBLICATION_IMMUTABLE'); END;
ALTER TABLE cf_welcome ADD COLUMN publication_id TEXT;
ALTER TABLE cf_welcome_steps ADD COLUMN response_code TEXT REFERENCES cf_journey_step_publications(code);
CREATE INDEX cf_welcome_step_response ON cf_welcome_steps(response_code,donor_id);
