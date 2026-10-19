-- Explicit new stop requests withdraw at ingress; staff review ambiguous replies.
-- Keep the proposal on its reply so merge journals, backups and erasure retain
-- the same custody as the saved message.
ALTER TABLE cf_acks ADD COLUMN reply_to TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN letter_id TEXT REFERENCES cf_acks(id) ON DELETE CASCADE;
ALTER TABLE cf_reply_tasks ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0 CHECK(automatic IN (0,1));
ALTER TABLE cf_reply_tasks ADD COLUMN stop_status TEXT CHECK(stop_status IN ('proposed','confirmed','automatic','reversed'));
ALTER TABLE cf_reply_tasks ADD COLUMN stop_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_evidence TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_consent_id INTEGER;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_email TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_donor_id TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_proposed_at TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_proposed_by TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_confirmed_at TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_confirmed_by TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_withdrawal_id INTEGER;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_reversed_at TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_reversed_by TEXT;
ALTER TABLE cf_reply_tasks ADD COLUMN stop_reversal_reason TEXT;
UPDATE cf_reply_tasks SET automatic=1 WHERE status='filed' OR EXISTS(
 SELECT 1 FROM cf_events e WHERE e.action='reply.received' AND e.subject_id=cf_reply_tasks.id
 AND json_extract(e.detail,'$.automatic')=1
);
