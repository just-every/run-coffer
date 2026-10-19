-- Recognition has its own thank-you record, never a receipt or ledger entry.
CREATE TABLE cf_soft_credit_acknowledgments (
 soft_credit_id TEXT PRIMARY KEY REFERENCES cf_soft_credits(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version > 0),
 status TEXT NOT NULL CHECK(status IN ('acknowledged','not acknowledged','do not acknowledge')),
 acknowledged_on TEXT,
 method TEXT CHECK(method IN ('email','letter','phone call','in person','handwritten note','other')),
 interaction_id TEXT REFERENCES cf_interactions(id) ON DELETE CASCADE,
 note_id TEXT REFERENCES cf_donor_notes(id) ON DELETE CASCADE,
 reason TEXT,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 CHECK((status='acknowledged' AND acknowledged_on IS NOT NULL AND method IS NOT NULL AND reason IS NULL
   AND ((interaction_id IS NOT NULL AND note_id IS NULL) OR (interaction_id IS NULL AND note_id IS NOT NULL)))
  OR (status='not acknowledged' AND acknowledged_on IS NULL AND method IS NULL AND interaction_id IS NULL AND note_id IS NULL AND reason IS NULL)
  OR (status='do not acknowledge' AND acknowledged_on IS NULL AND method IS NULL AND interaction_id IS NULL AND note_id IS NULL AND reason IS NOT NULL AND length(trim(reason))>0))
);
