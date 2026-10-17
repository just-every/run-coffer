CREATE TABLE cf_call_tasks (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 source_key TEXT NOT NULL UNIQUE,
 source_kind TEXT NOT NULL,
 reason TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 owner_id TEXT NOT NULL,
 due_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','snoozed','done')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 interaction_id TEXT REFERENCES cf_interactions(id) ON DELETE SET NULL
);
CREATE INDEX cf_call_task_owner ON cf_call_tasks(owner_id,status,due_on);
CREATE TRIGGER cf_call_task_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_call_tasks WHERE donor_id=NEW.id; END;
