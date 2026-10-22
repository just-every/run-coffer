CREATE TABLE cf_pledge_template (
 id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT
);
INSERT INTO cf_pledge_template VALUES(1,1,'Pledge reminder from {{organization|your organization}}','Dear {{donor_name}},

This is a reminder of your {{installment_amount}} pledge installment to {{organization|our organization}} for {{fund}}, due {{due_date}}.

If you have already sent your gift, thank you. Please contact us if your plans have changed.',NULL,NULL);
CREATE TABLE cf_pledge_template_versions (
 version INTEGER PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL,
 reviewed_at TEXT, reviewed_by TEXT
);
ALTER TABLE cf_pledge_installments ADD COLUMN reminder_subject TEXT;
ALTER TABLE cf_pledge_installments ADD COLUMN reminder_body TEXT;
ALTER TABLE cf_pledge_installments ADD COLUMN reminder_template_version INTEGER;
ALTER TABLE cf_pledge_installments ADD COLUMN reminder_merge_blanks TEXT;
ALTER TABLE cf_pledge_installments ADD COLUMN reminder_merge_checked_at TEXT;
DROP VIEW cf_pledge_balances;
CREATE VIEW cf_pledge_balances AS SELECT i.id,i.pledge_id,i.position,i.due_on,
 i.amount_cents-COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_adjustments a WHERE a.installment_id=i.id),0) AS amount_cents,
 i.amount_cents AS original_amount_cents,i.remind_on,i.reminder_status,i.attempt_id,i.attempt_started_at,
 i.recipient_email,i.recipient_contact_id,i.recipient_contact_version,i.message_id,i.submitted_at,i.reminder_note,
 i.reminder_subject,i.reminder_body,i.reminder_template_version,i.reminder_merge_blanks,i.reminder_merge_checked_at,i.paid_cents FROM cf_pledge_payment_balances i;
