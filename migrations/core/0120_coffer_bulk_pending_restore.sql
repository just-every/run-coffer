ALTER TABLE cf_list_bulk_jobs ADD COLUMN pending_restored_at TEXT;
-- Earlier undo implementations restored pending work as part of undo itself.
UPDATE cf_list_bulk_jobs SET pending_restored_at=undone_at WHERE kind='status' AND undone_at IS NOT NULL;
