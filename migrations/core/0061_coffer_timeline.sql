-- Native notes share the existing portable, merge-aware, erasable note store.
ALTER TABLE cf_donor_notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note' CHECK(kind IN ('note','visit'));
ALTER TABLE cf_donor_notes ADD COLUMN confidential INTEGER NOT NULL DEFAULT 0 CHECK(confidential IN (0,1));
ALTER TABLE cf_donor_notes ADD COLUMN who TEXT;
ALTER TABLE cf_donor_notes ADD COLUMN next_step TEXT;
ALTER TABLE cf_donor_notes ADD COLUMN recorded_by_id TEXT;
