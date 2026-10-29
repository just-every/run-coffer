-- A provider's local record IDs cannot join records from another organization.
-- This is provenance, never an API key or a live provider authorization.
CREATE TABLE cf_neon_source_identity (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 organization_hash TEXT NOT NULL,
 organization_id TEXT NOT NULL,
 reviewed_at TEXT NOT NULL,
 reviewed_by TEXT NOT NULL
);
