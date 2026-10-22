-- Retain the old storage column for archive compatibility; current readers use
-- period. Prior annual choices adopt ct's conservative rolling-year default.
ALTER TABLE cf_solicitation RENAME COLUMN period TO legacy_calendar_period;
ALTER TABLE cf_solicitation ADD COLUMN period TEXT NOT NULL DEFAULT 'rolling-12-months'
 CHECK(period IN ('rolling-12-months','calendar-year','calendar-quarter','calendar-month','fiscal-year','fiscal-quarter','fiscal-month'));
UPDATE cf_solicitation SET period=legacy_calendar_period WHERE legacy_calendar_period<>'calendar-year';
