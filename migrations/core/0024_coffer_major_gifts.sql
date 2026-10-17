-- Opportunities remain distinct when donors merge, preserving each ask and
-- next step. There is deliberately no unique constraint on donor_id.
-- Staff identities are excluded from portable archives. Validate owners at
-- each write, and show restored tasks for reassignment without an identity FK.
CREATE TABLE cf_prospects (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN ('identify','qualify','cultivate','ask','stewardship')),
 owner_id TEXT NOT NULL,
 ask_amount_cents INTEGER NOT NULL CHECK(typeof(ask_amount_cents)='integer' AND ask_amount_cents BETWEEN 0 AND 10000000000),
 expected_close_on TEXT NOT NULL,
 next_step TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE INDEX cf_prospect_donor ON cf_prospects(donor_id);
CREATE INDEX cf_prospect_stage_owner ON cf_prospects(stage,owner_id,expected_close_on);

-- Erasure can be initiated outside Coffer's normal command path. Delete the
-- entire opportunity, including its private label and next-step content.
CREATE TRIGGER cf_major_gift_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_prospects WHERE donor_id=NEW.id;
END;
