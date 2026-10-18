-- Source identities and both pre-merge emails remain usable by later imports.
-- These are historical aliases, not extra mailing addresses or portal grants.
CREATE TABLE cf_donor_aliases (
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 PRIMARY KEY(donor_id,email)
);
CREATE INDEX cf_donor_alias_email ON cf_donor_aliases(email);

-- Reconciliation belongs to the source constituent, even after its donor's
-- native identity joins another record. Existing import custody is unchanged.
ALTER TABLE cf_move_in_job_gifts ADD COLUMN donor_source_key TEXT;
UPDATE cf_move_in_job_gifts SET donor_source_key=(
 SELECT donor.source_key FROM cf_move_in_records gift
 JOIN cf_move_in_jobs job ON job.id=cf_move_in_job_gifts.job_id
 JOIN cf_move_in_records donor ON donor.source=job.source AND donor.kind='donor'
  AND donor.native_id=json_extract(gift.snapshot,'$.donor_id')
 WHERE gift.kind='gift' AND gift.native_id=cf_move_in_job_gifts.gift_id AND gift.source=job.source
 LIMIT 1
);

-- Related people can share an address. Unrelated active identities still cannot.
DROP INDEX cf_donor_email;
CREATE INDEX cf_donor_email ON cf_donors(email) WHERE email IS NOT NULL;
CREATE TRIGGER cf_donor_email_insert BEFORE INSERT ON cf_donors
WHEN NEW.email IS NOT NULL AND NEW.erased_at IS NULL AND (
 EXISTS(SELECT 1 FROM cf_donors d LEFT JOIN cf_donor_merges m ON m.donor_id=d.id
  JOIN cf_donors owner ON owner.id=COALESCE(m.into_id,d.id)
  WHERE d.email=NEW.email AND m.donor_id IS NULL AND owner.id<>NEW.id AND owner.erased_at IS NULL
  AND (NEW.household_id IS NULL OR owner.household_id IS NULL OR owner.household_id<>NEW.household_id)))
BEGIN SELECT RAISE(ABORT,'COFFER_DUPLICATE_EMAIL'); END;
CREATE TRIGGER cf_donor_email_update BEFORE UPDATE OF email,household_id ON cf_donors
WHEN NEW.email IS NOT NULL AND NEW.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=NEW.id) AND (
 EXISTS(SELECT 1 FROM cf_donors d LEFT JOIN cf_donor_merges m ON m.donor_id=d.id
  JOIN cf_donors owner ON owner.id=COALESCE(m.into_id,d.id)
  WHERE d.email=NEW.email AND m.donor_id IS NULL AND owner.id<>NEW.id AND owner.erased_at IS NULL
  AND (NEW.household_id IS NULL OR owner.household_id IS NULL OR owner.household_id<>NEW.household_id)))
BEGIN SELECT RAISE(ABORT,'COFFER_DUPLICATE_EMAIL'); END;

-- Personal before/after values stay out of cf_events. Each captured native row
-- is separate, avoiding a whole-donor JSON value at D1's per-row size boundary.
CREATE TABLE cf_donor_merge_journal (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL,
 target_id TEXT NOT NULL,
 merged_at TEXT NOT NULL,
 merged_by TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','undoing','undone','erased')),
 undone_at TEXT,
 undone_by TEXT,
 erased_at TEXT,
 CHECK(source_id<>target_id)
);
CREATE INDEX cf_donor_merge_history ON cf_donor_merge_journal(target_id,merged_at);
CREATE TABLE cf_donor_merge_rows (
 merge_id TEXT NOT NULL REFERENCES cf_donor_merge_journal(id) ON DELETE CASCADE,
 phase TEXT NOT NULL CHECK(phase IN ('before','after')),
 table_name TEXT NOT NULL,
 row_key TEXT NOT NULL CHECK(json_valid(row_key)),
 value TEXT NOT NULL CHECK(json_valid(value)),
 PRIMARY KEY(merge_id,phase,table_name,row_key)
);

-- A reverse move is legal only for the exact row recorded by a journal whose
-- authorized undo transaction has entered undoing. No financial edit is allowed.
DROP TRIGGER cf_gift_immutable;
CREATE TRIGGER cf_gift_immutable BEFORE UPDATE ON cf_gifts
WHEN NEW.id IS NOT OLD.id OR (NEW.donor_id IS NOT OLD.donor_id
 AND NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=NEW.donor_id AND erased_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=OLD.donor_id AND into_id=NEW.donor_id)
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merge_journal j
  JOIN cf_donor_merge_rows b ON b.merge_id=j.id AND b.phase='before' AND b.table_name='cf_gifts' AND b.row_key=json_array(OLD.id)
  JOIN cf_donor_merge_rows a ON a.merge_id=j.id AND a.phase='after' AND a.table_name=b.table_name AND a.row_key=b.row_key
  WHERE j.status='undoing' AND j.source_id=NEW.donor_id AND j.target_id=OLD.donor_id
   AND json_extract(b.value,'$.donor_id')=NEW.donor_id AND json_extract(a.value,'$.donor_id')=OLD.donor_id))
 OR NEW.kind IS NOT OLD.kind OR NEW.reverses IS NOT OLD.reverses
 OR NEW.received_on IS NOT OLD.received_on OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.method IS NOT OLD.method
 OR NEW.reference IS NOT OLD.reference OR NEW.fund IS NOT OLD.fund OR NEW.pledge_id IS NOT OLD.pledge_id
 OR NEW.source IS NOT OLD.source OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.note IS NOT OLD.note AND NEW.note IS NOT NULL)
 OR ((NEW.goods IS NOT OLD.goods OR NEW.goods_cents IS NOT OLD.goods_cents OR NEW.goods_description IS NOT OLD.goods_description) AND OLD.goods<>'unknown')
BEGIN SELECT RAISE(ABORT,'COFFER_GIFT_IMMUTABLE'); END;
DROP TRIGGER cf_consent_append_only;
CREATE TRIGGER cf_consent_append_only BEFORE UPDATE ON cf_consents
WHEN NEW.id IS NOT OLD.id OR NEW.channel IS NOT OLD.channel OR NEW.status IS NOT OLD.status
 OR NEW.method IS NOT OLD.method OR NEW.evidence IS NOT OLD.evidence OR NEW.captured_on IS NOT OLD.captured_on
 OR NEW.recorded_at IS NOT OLD.recorded_at OR NEW.recorded_by IS NOT OLD.recorded_by
 OR (NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=OLD.donor_id AND into_id=NEW.donor_id)
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merge_journal j
  JOIN cf_donor_merge_rows b ON b.merge_id=j.id AND b.phase='before' AND b.table_name='cf_consents' AND b.row_key=json_array(OLD.id)
  JOIN cf_donor_merge_rows a ON a.merge_id=j.id AND a.phase='after' AND a.table_name=b.table_name AND a.row_key=b.row_key
  WHERE j.status='undoing' AND j.source_id=NEW.donor_id AND j.target_id=OLD.donor_id
   AND json_extract(b.value,'$.donor_id')=NEW.donor_id AND json_extract(a.value,'$.donor_id')=OLD.donor_id))
BEGIN SELECT RAISE(ABORT,'COFFER_CONSENT_APPEND_ONLY'); END;

-- An erasure may arrive through a native caller. Remove every private snapshot
-- that could recreate this person, including attribution captured on other gifts.
CREATE TRIGGER cf_donor_merge_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 UPDATE cf_donor_merge_journal SET status='erased',erased_at=NEW.erased_at
 WHERE source_id=NEW.id OR target_id=NEW.id OR id IN (
  SELECT merge_id FROM cf_donor_merge_rows WHERE
   (table_name='cf_donors' AND json_extract(value,'$.id')=NEW.id)
   OR json_extract(value,'$.donor_id')=NEW.id OR json_extract(value,'$.related_donor_id')=NEW.id
   OR json_extract(value,'$.employer_donor_id')=NEW.id);
 DELETE FROM cf_donor_merge_rows WHERE merge_id IN (SELECT id FROM cf_donor_merge_journal WHERE status='erased');
 DELETE FROM cf_donor_aliases WHERE donor_id=NEW.id;
END;
