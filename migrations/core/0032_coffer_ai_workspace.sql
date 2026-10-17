-- Workspace-scoped keys can omit this; multi-workspace keys must select one.
ALTER TABLE cf_stewardship_setup ADD COLUMN workspace_id TEXT;
