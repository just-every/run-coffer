CREATE TABLE cf_research_connection (
 id INTEGER PRIMARY KEY CHECK(id=1),
 provider TEXT NOT NULL CHECK(provider='wealthengine'),
 encrypted_key TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 connected_at TEXT NOT NULL
);

-- Only the permitted research fields are retained, never the provider profile.
CREATE TABLE cf_research_results (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider='wealthengine'),
 provider_profile_id TEXT,
 researched_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('matched','no_match')),
 wealth_rating TEXT,
 wealth_score INTEGER,
 capacity_range TEXT,
 capacity_low TEXT,
 capacity_high TEXT,
 propensity TEXT,
 propensity_code TEXT,
 annual_donations TEXT
);

CREATE TRIGGER cf_research_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_research_results WHERE donor_id=NEW.id;
END;
