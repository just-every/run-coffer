-- Custom captures retain exact originals in bounded, portable rows.
CREATE TABLE cf_move_in_custom_reviews (
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(job_id,position)
);
CREATE TRIGGER cf_custom_review_redaction AFTER UPDATE OF redacted ON cf_move_in_jobs
WHEN NEW.redacted=1
BEGIN
 DELETE FROM cf_move_in_custom_reviews WHERE job_id=NEW.id;
END;
