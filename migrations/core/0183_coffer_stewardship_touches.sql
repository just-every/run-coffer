-- Existing drafts remain personal emails. Task rows hold no private draft text.
ALTER TABLE cf_stewardship_drafts ADD COLUMN format TEXT NOT NULL DEFAULT 'email'
 CHECK(format IN ('email','call','card'));
ALTER TABLE cf_call_tasks ADD COLUMN stewardship_draft_id TEXT REFERENCES cf_stewardship_drafts(id) ON DELETE SET NULL;
ALTER TABLE cf_call_tasks ADD COLUMN stewardship_version INTEGER;
CREATE UNIQUE INDEX cf_stewardship_task ON cf_call_tasks(stewardship_draft_id)
 WHERE stewardship_draft_id IS NOT NULL;
