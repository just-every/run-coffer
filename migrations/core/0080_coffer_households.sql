-- Explicit household identity; headship never assigns gift authority.
ALTER TABLE cf_households ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE cf_households ADD COLUMN head_donor_id TEXT;
ALTER TABLE cf_households ADD COLUMN addressee_override TEXT;
ALTER TABLE cf_households ADD COLUMN formal_override TEXT;
ALTER TABLE cf_households ADD COLUMN informal_override TEXT;
ALTER TABLE cf_households ADD COLUMN overrides_review INTEGER NOT NULL DEFAULT 0 CHECK(overrides_review IN (0,1));
ALTER TABLE cf_households ADD COLUMN head_source TEXT;
ALTER TABLE cf_households ADD COLUMN head_imported_at TEXT;
ALTER TABLE cf_donors ADD COLUMN prefix TEXT;
ALTER TABLE cf_donors ADD COLUMN first_name TEXT;
ALTER TABLE cf_donors ADD COLUMN middle_name TEXT;
ALTER TABLE cf_donors ADD COLUMN last_name TEXT;
ALTER TABLE cf_donors ADD COLUMN suffix TEXT;
ALTER TABLE cf_donors ADD COLUMN nickname TEXT;
ALTER TABLE cf_donors ADD COLUMN constituent_kind TEXT NOT NULL DEFAULT 'person' CHECK(constituent_kind IN ('person','organization'));
ALTER TABLE cf_donors ADD COLUMN constituent_status TEXT NOT NULL DEFAULT 'active' CHECK(constituent_status IN ('active','inactive','deceased'));
CREATE TABLE cf_household_defaults (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1,
 addressee TEXT NOT NULL, formal TEXT NOT NULL, informal TEXT NOT NULL
);
INSERT INTO cf_household_defaults VALUES(1,1,'{{full_names}}','{{formal_names}}','{{first_names}}');
