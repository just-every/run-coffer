-- Preserve source dimensions and original dates as migration evidence only.
-- These columns do not create any native subscription or payment authority.
ALTER TABLE cf_recurring_source_references ADD COLUMN fund TEXT NOT NULL DEFAULT '';
ALTER TABLE cf_recurring_source_references ADD COLUMN appeal TEXT NOT NULL DEFAULT '';
ALTER TABLE cf_recurring_source_references ADD COLUMN source_schedule TEXT NOT NULL DEFAULT '{}';
