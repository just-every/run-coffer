-- Task lists carry the work assignment, never a copy of private draft sources.
ALTER TABLE cf_stewardship_drafts ADD COLUMN format TEXT NOT NULL DEFAULT 'email'
 CHECK(format IN ('email','call','card'));
ALTER TABLE cf_stewardship_drafts ADD COLUMN task_id TEXT REFERENCES cf_call_tasks(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX cf_stewardship_task ON cf_stewardship_drafts(task_id) WHERE task_id IS NOT NULL;
