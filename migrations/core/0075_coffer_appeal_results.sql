-- Explicit permanent identity for new runs; historical runs deliberately remain unbound.
CREATE TABLE cf_appeal_runs (
 appeal_id TEXT PRIMARY KEY REFERENCES cf_appeals(id) ON DELETE CASCADE,
 code TEXT NOT NULL UNIQUE COLLATE NOCASE REFERENCES cf_appeal_codes(code),
 cost_cents INTEGER NOT NULL CHECK(typeof(cost_cents)='integer' AND cost_cents>=0)
);
CREATE TRIGGER cf_appeal_run_immutable BEFORE UPDATE ON cf_appeal_runs
BEGIN SELECT RAISE(ABORT,'COFFER_APPEAL_RUN_IMMUTABLE'); END;
