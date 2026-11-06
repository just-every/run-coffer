-- A run-wide public source binds the exact approved wording to its ordinary campaign.
-- No recipient identity, consent, provider delivery or provider credential is inferred.
CREATE TABLE cf_appeal_email_sources (
 id TEXT PRIMARY KEY,
 appeal_id TEXT NOT NULL UNIQUE REFERENCES cf_appeals(id),
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id),
 slug TEXT NOT NULL,
 fund TEXT NOT NULL,
 code TEXT NOT NULL REFERENCES cf_appeal_codes(code),
 url TEXT NOT NULL,
 content_hash TEXT NOT NULL
);
CREATE TRIGGER cf_appeal_email_source_frozen BEFORE UPDATE ON cf_appeal_email_sources
BEGIN SELECT RAISE(ABORT,'email appeal sources are immutable'); END;
ALTER TABLE cf_giving_intents ADD COLUMN email_source_id TEXT REFERENCES cf_appeal_email_sources(id);
CREATE TRIGGER cf_intent_email_source_frozen BEFORE UPDATE OF email_source_id ON cf_giving_intents
WHEN NEW.email_source_id IS NOT OLD.email_source_id
BEGIN SELECT RAISE(ABORT,'checkout email source is immutable'); END;
