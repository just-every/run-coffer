-- Preserve consent identity/history while adding the already documented phone/SMS channels.
PRAGMA defer_foreign_keys = on;
CREATE TABLE cf_consents_next (
 id INTEGER PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','mail','phone','sms')),
 status TEXT NOT NULL CHECK(status IN ('granted','withdrawn')), method TEXT NOT NULL,
 evidence TEXT NOT NULL, captured_on TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
INSERT INTO cf_consents_next SELECT * FROM cf_consents;
DROP TABLE cf_consents;
ALTER TABLE cf_consents_next RENAME TO cf_consents;
CREATE INDEX cf_consent_current ON cf_consents(donor_id,channel,id);
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


CREATE TRIGGER cf_consent_erasure_only BEFORE DELETE ON cf_consents
WHEN NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=OLD.donor_id AND erased_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM cf_move_in_records r JOIN cf_move_in_jobs j ON j.id=r.job_id
  WHERE r.kind='consent' AND r.owned=1 AND r.native_id=CAST(OLD.id AS TEXT)
   AND j.state IN ('applying','completed') AND json_extract(j.report,'$.solicitationUndoInProgress')=1
   AND r.snapshot=json_object('id',OLD.id,'donor_id',OLD.donor_id,'channel',OLD.channel,'status',OLD.status,'method',OLD.method,'evidence',OLD.evidence,'captured_on',OLD.captured_on,'recorded_at',OLD.recorded_at,'recorded_by',OLD.recorded_by))
BEGIN SELECT RAISE(ABORT,'COFFER_CONSENT_APPEND_ONLY'); END;
INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
 SELECT donor_id,'sms',status,source,evidence||' · Donor time zone: '||timezone,captured_on,recorded_at,recorded_by FROM cf_sms_preferences ORDER BY id;
CREATE TRIGGER cf_sms_permission_consent AFTER INSERT ON cf_sms_preferences BEGIN
 INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
 VALUES(NEW.donor_id,'sms',NEW.status,NEW.source,NEW.evidence||' · Donor time zone: '||NEW.timezone,NEW.captured_on,NEW.recorded_at,NEW.recorded_by);
END;
ALTER TABLE cf_call_tasks ADD COLUMN is_ask INTEGER NOT NULL DEFAULT 1 CHECK(is_ask IN (0,1));
UPDATE cf_call_tasks SET is_ask=0 WHERE source_kind IN ('pledge','recovery','gift');
ALTER TABLE cf_recurring_task_series ADD COLUMN is_ask INTEGER NOT NULL DEFAULT 1 CHECK(is_ask IN (0,1));
