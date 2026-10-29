-- Historical schedule and designation evidence never authorizes a charge.
ALTER TABLE cf_recurring_source_references ADD COLUMN source_details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_details));
