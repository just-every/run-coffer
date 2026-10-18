CREATE TABLE cf_recurring_task_series (
 id TEXT PRIMARY KEY,
 donor_id TEXT REFERENCES cf_donors(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 interval_months INTEGER NOT NULL CHECK(interval_months IN (1,3)),
 anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
 created_at TEXT NOT NULL
);
CREATE TABLE cf_recurring_tasks (
 id TEXT PRIMARY KEY,
 series_id TEXT NOT NULL REFERENCES cf_recurring_task_series(id) ON DELETE CASCADE,
 previous_id TEXT UNIQUE REFERENCES cf_recurring_tasks(id) ON DELETE SET NULL,
 due_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 completed_by TEXT,
 notes TEXT,
 UNIQUE(series_id,due_on)
);
CREATE INDEX cf_recurring_due ON cf_recurring_tasks(status,due_on);
CREATE TRIGGER cf_recurring_task_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN DELETE FROM cf_recurring_task_series WHERE donor_id=NEW.id; END;
