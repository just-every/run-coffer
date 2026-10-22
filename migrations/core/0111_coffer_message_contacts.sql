ALTER TABLE cf_pledge_installments ADD COLUMN recipient_contact_id TEXT;
ALTER TABLE cf_pledge_installments ADD COLUMN recipient_contact_version INTEGER;
ALTER TABLE cf_sms_recipients ADD COLUMN phone_contact_id TEXT;
ALTER TABLE cf_sms_recipients ADD COLUMN phone_contact_version INTEGER;
DROP VIEW cf_pledge_balances;
CREATE VIEW cf_pledge_balances AS SELECT i.id,i.pledge_id,i.position,i.due_on,
 i.amount_cents-COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_adjustments a WHERE a.installment_id=i.id),0) AS amount_cents,
 i.amount_cents AS original_amount_cents,i.remind_on,i.reminder_status,i.attempt_id,i.attempt_started_at,
 i.recipient_email,i.recipient_contact_id,i.recipient_contact_version,i.message_id,i.submitted_at,i.reminder_note,i.paid_cents FROM cf_pledge_payment_balances i;
