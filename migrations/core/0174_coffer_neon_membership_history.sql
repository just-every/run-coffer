-- Incumbent history is distinct from a native charging authorization.
CREATE TABLE cf_source_memberships (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 source_id TEXT NOT NULL,
 level_id TEXT NOT NULL,
 level_name TEXT NOT NULL,
 term_name TEXT NOT NULL,
 starts_on TEXT NOT NULL,
 ends_on TEXT,
 status TEXT NOT NULL,
 fee_cents INTEGER NOT NULL CHECK(fee_cents>=0),
 gift_id TEXT REFERENCES cf_gifts(id),
 source_auto_renewal INTEGER NOT NULL CHECK(source_auto_renewal IN (0,1)),
 source_active INTEGER NOT NULL CHECK(source_active IN (0,1)),
 imported_at TEXT NOT NULL,
 UNIQUE(source,source_id)
);
