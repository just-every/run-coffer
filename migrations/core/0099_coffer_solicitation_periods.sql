-- Existing answers and importer inserts keep their calendar-year meaning.
-- Historical answers are immutable; an absent historical period means the
-- annual behavior that existed when that answer was recorded.
ALTER TABLE cf_solicitation ADD COLUMN period TEXT NOT NULL DEFAULT 'calendar-year'
 CHECK(period IN ('calendar-year','calendar-quarter','calendar-month'));
