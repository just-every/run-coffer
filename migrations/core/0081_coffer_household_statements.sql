-- A household's mailing identity and members are facts of the prepared piece.
-- Household edits never update or void it. Financial void triggers continue to
-- find every included gift in statement_gifts under RCPT-008.
ALTER TABLE cf_acks ADD COLUMN household_id TEXT;
ALTER TABLE cf_acks ADD COLUMN household_version INTEGER;
ALTER TABLE cf_acks ADD COLUMN household_snapshot TEXT;
CREATE INDEX cf_ack_household ON cf_acks(household_id);
