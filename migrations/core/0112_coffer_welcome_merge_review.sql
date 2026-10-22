-- A missing optional field holds the existing pending step before any claim or
-- provider handoff. Check time gives held steps fair turns on later sweeps.
ALTER TABLE cf_welcome_steps ADD COLUMN merge_blanks TEXT;
ALTER TABLE cf_welcome_steps ADD COLUMN merge_checked_at TEXT;
