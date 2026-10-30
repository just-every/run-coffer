DROP VIEW cf_development_sources;
DROP VIEW cf_pledge_balances;
DROP TRIGGER cf_pledge_recurring_payment;
DROP TRIGGER cf_pledge_payment_version;
DROP VIEW cf_pledge_payment_balances;
DROP TRIGGER cf_allocation_insert;
DROP TRIGGER cf_pledge_no_split;
-- Replaced allocations remain immutable history; only active rows affect money.
CREATE TABLE cf_pledge_allocations_next (
 id TEXT PRIMARY KEY,
 installment_id TEXT NOT NULL REFERENCES cf_pledge_installments(id),
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
INSERT INTO cf_pledge_allocations_next SELECT * FROM cf_pledge_allocations;
DROP TABLE cf_pledge_allocations;
ALTER TABLE cf_pledge_allocations_next RENAME TO cf_pledge_allocations;
CREATE INDEX cf_pledge_allocation_gift ON cf_pledge_allocations(gift_id);
CREATE TABLE cf_move_in_allocation_sources (
 allocation_id TEXT PRIMARY KEY REFERENCES cf_pledge_allocations(id),
 source TEXT NOT NULL,
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id),
 source_file TEXT NOT NULL,
 source_gift_id TEXT NOT NULL,
 explicit_installment_id TEXT
);
CREATE TABLE cf_pledge_allocation_replacements (
 allocation_id TEXT PRIMARY KEY REFERENCES cf_pledge_allocations(id),
 job_id TEXT NOT NULL REFERENCES cf_move_in_jobs(id),
 source TEXT NOT NULL,
 source_file TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE VIEW cf_pledge_active_allocations AS SELECT a.* FROM cf_pledge_allocations a
 WHERE NOT EXISTS(SELECT 1 FROM cf_pledge_allocation_replacements r WHERE r.allocation_id=a.id);
CREATE TRIGGER cf_pledge_no_split BEFORE INSERT ON cf_pledge_allocations
WHEN EXISTS(SELECT 1 FROM cf_gift_allocations WHERE gift_id=NEW.gift_id)
BEGIN SELECT RAISE(ABORT,'COFFER_PLEDGE_SPLIT'); END;
CREATE TRIGGER cf_allocation_insert BEFORE INSERT ON cf_gift_allocations
WHEN NOT EXISTS(SELECT 1 FROM cf_gifts g WHERE g.id=NEW.gift_id AND g.kind='gift' AND g.pledge_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_pledge_active_allocations WHERE gift_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=g.id)
 AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM cf_gift_allocations WHERE gift_id=g.id),0)<=g.amount_cents)
 OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_campaigns WHERE id=NEW.campaign_id AND fund=NEW.fund))
 OR EXISTS(SELECT 1 FROM cf_gift_allocations a WHERE a.gift_id=NEW.gift_id AND
  ((a.campaign_id IS NULL)<>(NEW.campaign_id IS NULL) OR (NEW.campaign_id IS NULL AND a.fund=NEW.fund) OR a.campaign_id=NEW.campaign_id))
BEGIN SELECT RAISE(ABORT,'COFFER_ALLOCATION_INVALID'); END;
CREATE VIEW cf_pledge_payment_balances AS
 SELECT i.*,COALESCE((SELECT SUM(MAX(0,MIN(a.amount_cents,g.net_cents-
  COALESCE((SELECT SUM(prior.amount_cents) FROM cf_pledge_active_allocations prior WHERE prior.gift_id=a.gift_id
   AND (prior.created_at<a.created_at OR (prior.created_at=a.created_at AND prior.id<a.id))),0))))
 FROM cf_pledge_active_allocations a JOIN cf_gift_balances g ON g.id=a.gift_id WHERE a.installment_id=i.id),0) AS paid_cents
 FROM cf_pledge_installments i;
CREATE TRIGGER cf_pledge_payment_version AFTER INSERT ON cf_pledge_allocations BEGIN
 UPDATE cf_pledges SET version=version+1 WHERE id=(SELECT pledge_id FROM cf_pledge_installments WHERE id=NEW.installment_id);
END;
CREATE TRIGGER cf_pledge_recurring_payment AFTER INSERT ON cf_subscription_gifts BEGIN
 INSERT OR IGNORE INTO cf_pledge_allocations(id,installment_id,gift_id,amount_cents,created_at,created_by)
 SELECT NEW.gift_id||':'||q.id,q.id,NEW.gift_id,MIN(q.remaining,q.available-q.prior),q.created_at,'Recurring plan'
 FROM (SELECT i.id,i.amount_cents-i.paid_cents AS remaining,g.net_cents AS available,g.created_at,
 COALESCE(SUM(i.amount_cents-i.paid_cents) OVER(ORDER BY i.due_on,i.position,i.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior
 FROM cf_pledge_plans link JOIN cf_pledges p ON p.id=link.pledge_id
 JOIN cf_pledge_balances i ON i.pledge_id=p.id
 JOIN cf_gift_balances g ON g.id=NEW.gift_id AND g.donor_id=p.donor_id AND g.fund=p.fund
 JOIN cf_donors d ON d.id=p.donor_id AND d.erased_at IS NULL
 WHERE link.subscription_id=NEW.subscription_id AND i.amount_cents>i.paid_cents
 AND NOT EXISTS(SELECT 1 FROM cf_pledge_active_allocations a WHERE a.gift_id=g.id)) q
 WHERE q.available>q.prior;
END;
CREATE VIEW cf_pledge_balances AS SELECT i.id,i.pledge_id,i.position,i.due_on,
 i.amount_cents-COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_adjustments a WHERE a.installment_id=i.id),0) AS amount_cents,
 i.amount_cents AS original_amount_cents,i.remind_on,i.reminder_status,i.attempt_id,i.attempt_started_at,
 i.recipient_email,i.recipient_contact_id,i.recipient_contact_version,i.message_id,i.submitted_at,i.reminder_note,
 i.reminder_subject,i.reminder_body,i.reminder_template_version,i.reminder_merge_blanks,i.reminder_merge_checked_at,i.paid_cents FROM cf_pledge_payment_balances i;
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
CREATE TRIGGER cf_pledge_allocation_once BEFORE INSERT ON cf_pledge_allocations
 WHEN EXISTS(SELECT 1 FROM cf_pledge_active_allocations a WHERE a.gift_id=NEW.gift_id AND a.installment_id=NEW.installment_id)
 BEGIN SELECT RAISE(ABORT,'COFFER_PLEDGE_ALLOCATION_DUPLICATE'); END;
CREATE TRIGGER cf_pledge_replacement_version AFTER INSERT ON cf_pledge_allocation_replacements BEGIN
 UPDATE cf_pledges SET version=version+1 WHERE id=(SELECT i.pledge_id FROM cf_pledge_allocations a JOIN cf_pledge_installments i ON i.id=a.installment_id WHERE a.id=NEW.allocation_id);
END;
