-- A saved list stores a live search definition, never a frozen donor audience.
CREATE TABLE cf_saved_lists (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 filters TEXT NOT NULL CHECK(json_valid(filters) AND json_type(filters)='object'),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
