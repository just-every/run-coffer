-- Earlier undos discarded the source index, leaving captured private values
-- without donor erasure custody. Keep historical totals and reusable mappings.
UPDATE cf_move_in_jobs SET report=json_remove(report,'$.customReview')
WHERE state='undone' AND json_type(report,'$.customReview') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM cf_move_in_source_records WHERE job_id=cf_move_in_jobs.id);
