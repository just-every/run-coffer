-- A Coffer restriction never changes the native account role or session.
-- Versions survive explicit removal so previously authorized work stays stale.
CREATE TABLE cf_team_access (
 operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id) ON DELETE CASCADE,
 read_only INTEGER NOT NULL CHECK(read_only IN (0,1)),
 version INTEGER NOT NULL CHECK(version>0),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
