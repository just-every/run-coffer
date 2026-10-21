-- DONOR-014: explicit formal salutation and envelope name; blank means computed from the name parts.
ALTER TABLE cf_donors ADD COLUMN formal_salutation TEXT;
ALTER TABLE cf_donors ADD COLUMN envelope_name TEXT;
