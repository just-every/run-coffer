-- Each check retains its entered fund while the batch keeps its default.
ALTER TABLE cf_batch_entries ADD COLUMN fund TEXT;
