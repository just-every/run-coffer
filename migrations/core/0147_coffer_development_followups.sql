-- Development follow-ups are reviewable work; financial facts remain native.
CREATE TABLE cf_development_followups (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('installment','report','match')),
 source_id TEXT NOT NULL, donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 installment_id TEXT REFERENCES cf_pledge_installments(id) ON DELETE CASCADE,
 report_id TEXT REFERENCES cf_grant_tasks(id) ON DELETE CASCADE,
 match_id TEXT REFERENCES cf_employer_matches(id) ON DELETE CASCADE,
 version INTEGER NOT NULL DEFAULT 1, source_token TEXT NOT NULL,
 due_on TEXT NOT NULL, amount_cents INTEGER NOT NULL, recipient_email TEXT,
 body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 reply_at TEXT, reply_note TEXT, resolution TEXT CHECK(resolution IN ('paid','revised','written_off')),
 resolution_note TEXT, resolved_at TEXT, resolved_by TEXT,
 UNIQUE(kind,source_id)
);
CREATE TABLE cf_development_reminders (
 id TEXT PRIMARY KEY, followup_id TEXT NOT NULL REFERENCES cf_development_followups(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, source_token TEXT NOT NULL, recipient_email TEXT NOT NULL, body TEXT NOT NULL,
 approved_by TEXT NOT NULL, approver_version INTEGER NOT NULL, approved_at TEXT NOT NULL, authority_note TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('approved','sending','submitted','uncertain','rejected','invalidated')),
 attempted_at TEXT, submitted_at TEXT, message_id TEXT, claim_id TEXT,
 UNIQUE(followup_id,version)
);
CREATE INDEX cf_development_reminder_status ON cf_development_reminders(status);
CREATE TRIGGER cf_development_erasure AFTER UPDATE OF erased_at ON cf_donors WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_development_followups WHERE donor_id=NEW.id;
END;
CREATE TRIGGER cf_development_merge_hold BEFORE INSERT ON cf_donor_merges
WHEN EXISTS(SELECT 1 FROM cf_development_reminders r JOIN cf_development_followups f ON f.id=r.followup_id
 WHERE r.status='sending' AND (f.donor_id IN (NEW.donor_id,NEW.into_id) OR (f.kind='match' AND EXISTS(SELECT 1 FROM cf_employer_matches m JOIN cf_gifts g ON g.id=m.gift_id WHERE m.id=f.source_id AND g.donor_id IN (NEW.donor_id,NEW.into_id)))))
BEGIN SELECT RAISE(ABORT,'COFFER_DEVELOPMENT_SENDING'); END;
CREATE TRIGGER cf_development_merge AFTER INSERT ON cf_donor_merges BEGIN
 UPDATE cf_development_reminders SET status='invalidated' WHERE status='approved' AND followup_id IN
  (SELECT f.id FROM cf_development_followups f WHERE f.donor_id IN (NEW.donor_id,NEW.into_id) OR
   (f.kind='match' AND EXISTS(SELECT 1 FROM cf_employer_matches m JOIN cf_gifts g ON g.id=m.gift_id WHERE m.id=f.source_id AND g.donor_id IN (NEW.donor_id,NEW.into_id))));
 UPDATE cf_development_followups SET donor_id=NEW.into_id,version=version+1,recipient_email=NULL,
  source_token='merged',body='Refresh this follow-up after the merge.' WHERE donor_id IN (NEW.donor_id,NEW.into_id);
END;
-- Reserve the old one-time overdue sender as soon as a reviewable finding exists.
CREATE TRIGGER cf_development_reserve_installment AFTER INSERT ON cf_development_followups WHEN NEW.kind='installment' BEGIN
 INSERT OR IGNORE INTO cf_pledge_followups(installment_id,attempt_id,status,attempted_at)
 VALUES(NEW.source_id,'development:'||NEW.id,'development_managed',NEW.created_at);
END;
CREATE VIEW cf_development_sources AS
 SELECT 'installment' AS kind,i.id AS source_id,p.donor_id,i.due_on,MAX(0,i.amount_cents-i.paid_cents) AS amount_cents,
 json_array(p.version,p.donor_id,i.due_on,i.amount_cents,i.paid_cents) AS source_token,p.fund||' pledge installment' AS title,
 d.email AS recipient_email,NULL AS owner_id,
 (i.amount_cents>0 AND i.paid_cents>=i.amount_cents) AS settled,
 (i.amount_cents>i.paid_cents) AS outstanding,
 d.constituent_status='active' AS active,
 CASE WHEN old.status IS NOT NULL AND old.status<>'development_managed' THEN 'Existing pledge follow-up: '||old.status
 WHEN (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1) IS NOT 'granted' THEN 'Current email consent is required'
 WHEN NOT EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.donor_id=d.id AND cp.kind='email' AND cp.active=1 AND cp.is_primary=1 AND cp.value=d.email) THEN 'Current primary email is required'
 WHEN EXISTS(SELECT 1 FROM cf_acks a WHERE a.donor_id=d.id AND a.recipient_email=d.email AND a.delivery_status IN ('bounced','complained')) THEN 'Email delivery is held'
 WHEN d.email IS NULL THEN 'Current email is required' ELSE NULL END AS hold
 FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
 LEFT JOIN cf_pledge_followups old ON old.installment_id=i.id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
 UNION ALL
 SELECT 'report',t.id,g.donor_id,t.due_on,0,json_array(t.version,g.version,g.donor_id,t.due_on,t.owner_id,t.status),t.title,
 o.email,t.owner_id,t.status='done',t.status='open',d.constituent_status='active',
 CASE WHEN o.id IS NULL OR o.status<>'active' OR o.role NOT IN ('owner','admin','member') THEN 'Assign a current report owner' ELSE NULL END
 FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id JOIN cf_donors d ON d.id=g.donor_id LEFT JOIN oa_operators o ON o.id=t.owner_id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
 UNION ALL
 SELECT 'match',m.id,m.employer_donor_id,m.due_by,MAX(0,m.amount_cents-COALESCE(actual.net_cents,0)),
 json_array(m.due_by,m.amount_cents,m.employer_donor_id,original.donor_id,m.received_gift_id,COALESCE(actual.net_cents,0),original.net_cents),
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
