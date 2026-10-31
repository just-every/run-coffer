-- Reviews store only evidence digests. Completion is recomputed from live imports.
CREATE TABLE cf_move_in_checklists (
 source TEXT PRIMARY KEY CHECK(source IN ('lgl','bloomerang','re-nxt','neon','givebutter','zeffy')),
 version INTEGER NOT NULL CHECK(version > 0),
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id),
 names_hash TEXT,
 fields_hash TEXT,
 reconciliation_hash TEXT,
 reviewed_at TEXT NOT NULL,
 reviewed_by TEXT NOT NULL
);
