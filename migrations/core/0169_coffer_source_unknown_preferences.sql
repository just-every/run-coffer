-- Preserve explicit unknown source preferences without turning them into permission.
PRAGMA defer_foreign_keys = on;
DROP VIEW cf_development_sources;
CREATE TABLE cf_consents_next (
 id INTEGER PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','mail','phone','sms')),
 status TEXT NOT NULL CHECK(status IN ('granted','withdrawn','unknown')), method TEXT NOT NULL,
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
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merge_journal j JOIN cf_donor_merge_rows a ON a.merge_id=j.id AND a.phase='after' AND a.table_name='cf_consents' AND a.row_key=json_array(OLD.id)
  WHERE j.status='undoing' AND NOT EXISTS(SELECT 1 FROM cf_donor_merge_rows b WHERE b.merge_id=j.id AND b.phase='before' AND b.table_name=a.table_name AND b.row_key=a.row_key)
   AND a.value=json_object('id',OLD.id,'donor_id',OLD.donor_id,'channel',OLD.channel,'status',OLD.status,'method',OLD.method,'evidence',OLD.evidence,'captured_on',OLD.captured_on,'recorded_at',OLD.recorded_at,'recorded_by',OLD.recorded_by))
BEGIN SELECT RAISE(ABORT,'COFFER_CONSENT_APPEND_ONLY'); END;

CREATE VIEW cf_development_sources AS
 SELECT 'installment' AS kind,i.id AS source_id,p.donor_id,i.due_on,MAX(0,i.amount_cents-i.paid_cents) AS amount_cents,
 json_array(p.version,p.donor_id,d.version,(SELECT MAX(id) FROM cf_consents WHERE donor_id=d.id AND channel='email'),i.due_on,i.amount_cents,i.paid_cents) AS source_token,p.fund||' pledge installment' AS title,
 d.email AS recipient_email,NULL AS owner_id,
 (i.amount_cents>0 AND i.paid_cents>=i.amount_cents) AS settled,
 (i.amount_cents>i.paid_cents) AS outstanding,
 d.constituent_status='active' AS active,
 CASE WHEN old.status IS NOT NULL AND old.status<>'review' THEN 'Existing pledge follow-up: '||old.status
 WHEN (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1) IS NOT 'granted' THEN 'Current email consent is required'
 WHEN NOT EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.donor_id=d.id AND cp.kind='email' AND cp.active=1 AND cp.is_primary=1 AND cp.value=d.email) THEN 'Current primary email is required'
 WHEN EXISTS(SELECT 1 FROM cf_acks a WHERE a.donor_id=d.id AND a.recipient_email=d.email AND a.delivery_status IN ('bounced','complained')) THEN 'Email delivery is held'
 WHEN d.email IS NULL THEN 'Current email is required' ELSE NULL END AS hold
 FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
 LEFT JOIN cf_pledge_followups old ON old.installment_id=i.id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
 UNION ALL
 SELECT 'report',t.id,g.donor_id,t.due_on,0,json_array(t.version,g.version,g.donor_id,o.version,t.due_on,t.owner_id,t.status),t.title,
 o.email,t.owner_id,t.status='done',t.status='open',d.constituent_status='active',
 CASE WHEN o.id IS NULL OR o.status<>'active' OR o.role NOT IN ('owner','admin','member') THEN 'Assign a current report owner' ELSE NULL END
 FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id JOIN cf_donors d ON d.id=g.donor_id LEFT JOIN oa_operators o ON o.id=t.owner_id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
 UNION ALL
 SELECT 'match',m.id,m.employer_donor_id,m.due_by,MAX(0,m.amount_cents-COALESCE(actual.net_cents,0)),
 json_array(m.due_by,m.amount_cents,m.employer_donor_id,d.version,(SELECT MAX(id) FROM cf_consents WHERE donor_id=d.id AND channel='email'),original.donor_id,m.received_gift_id,COALESCE(actual.net_cents,0),original.net_cents),
 'Employer matching gift',d.email,NULL,
 (actual.donor_id=m.employer_donor_id AND actual.net_cents>=m.amount_cents AND actual.net_cents>0),
 (original.net_cents>0 AND (actual.id IS NULL OR actual.donor_id<>m.employer_donor_id OR actual.net_cents<m.amount_cents)),d.constituent_status='active',
 CASE WHEN (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1) IS NOT 'granted' THEN 'Current email consent is required'
 WHEN NOT EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.donor_id=d.id AND cp.kind='email' AND cp.active=1 AND cp.is_primary=1 AND cp.value=d.email) THEN 'Current primary email is required'
 WHEN EXISTS(SELECT 1 FROM cf_acks a WHERE a.donor_id=d.id AND a.recipient_email=d.email AND a.delivery_status IN ('bounced','complained')) THEN 'Email delivery is held'
 WHEN d.email IS NULL THEN 'Current email is required' ELSE NULL END
 FROM cf_employer_matches m JOIN cf_gift_balances original ON original.id=m.gift_id JOIN cf_donors employee ON employee.id=original.donor_id
 JOIN cf_donors d ON d.id=m.employer_donor_id LEFT JOIN cf_gift_balances actual ON actual.id=m.received_gift_id
 WHERE d.erased_at IS NULL AND employee.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id IN (d.id,employee.id));
