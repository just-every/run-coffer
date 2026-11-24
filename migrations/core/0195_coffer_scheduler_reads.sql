-- The minute Cron reads indexed, bounded sets instead of whole tables: partial indexes over only the
-- open or pending rows, and one small cursor per sweep so an unchanged day costs a few rows.
CREATE TABLE cf_scheduler_state (
 name TEXT PRIMARY KEY, day TEXT NOT NULL, event_id INTEGER NOT NULL, key TEXT NOT NULL DEFAULT ''
);
CREATE INDEX cf_call_task_open ON cf_call_tasks(due_on) WHERE status<>'done';
CREATE INDEX cf_task_notice_day ON cf_task_notices(day,status);
CREATE INDEX cf_task_notice_sending ON cf_task_notices(attempted_at) WHERE status='sending';
CREATE INDEX cf_gift_tribute_donor ON cf_gift_tributes(donor_id);
CREATE INDEX cf_welcome_step_due ON cf_welcome_steps(due_at) WHERE status='pending';
CREATE INDEX cf_welcome_enrollment_active ON cf_welcome_enrollments(donor_id) WHERE status='active';
CREATE INDEX cf_journey_enrollment_active ON cf_journey_enrollments(enrolled_at,id) WHERE status='active';
CREATE INDEX cf_preference_sync_checked ON cf_preference_sync(checked_at);
CREATE INDEX cf_communication_open ON cf_communications(created_at) WHERE status IN ('submitted','uncertain');
CREATE INDEX cf_contact_donor ON cf_contact_points(donor_id,active);
CREATE INDEX cf_gift_pledge ON cf_gifts(pledge_id) WHERE pledge_id IS NOT NULL;
CREATE INDEX cf_pledge_installment_due ON cf_pledge_installments(due_on);
CREATE INDEX cf_payment_gift ON cf_payment_entries(gift_id);
