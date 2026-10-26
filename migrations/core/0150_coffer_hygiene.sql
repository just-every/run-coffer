CREATE TABLE cf_hygiene_evidence (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 source TEXT NOT NULL CHECK(source IN ('returned_mail','ncoa','family_note','obituary')),
 evidence TEXT NOT NULL, correction TEXT NOT NULL CHECK(json_valid(correction)),
 recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
CREATE TABLE cf_hygiene_proposals (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 related_donor_id TEXT REFERENCES cf_donors(id), evidence_id TEXT REFERENCES cf_hygiene_evidence(id),
 kind TEXT NOT NULL CHECK(kind IN ('merge','address','status','salutation')),
 evidence TEXT NOT NULL, command TEXT NOT NULL, input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 fingerprint TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','stale')),
 created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT
);
CREATE INDEX cf_hygiene_queue ON cf_hygiene_proposals(status,created_at);
