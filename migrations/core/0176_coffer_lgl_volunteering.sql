-- Per-review activity membership includes unchanged activities from earlier imports.
CREATE TABLE cf_move_in_job_volunteering (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id),
 activity_id TEXT NOT NULL REFERENCES cf_volunteering(id) ON DELETE CASCADE,
 donor_source_key TEXT NOT NULL,
 PRIMARY KEY(job_id,activity_id)
);
