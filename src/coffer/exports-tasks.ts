/** D1 bounds compound SELECT terms. Materialize the two task families within
 * the same read, then combine them without a six-term compound statement. */
export const taskRecords = `WITH work AS MATERIALIZED (SELECT t.id,t.donor_id,'call' AS task_kind,'Call' AS title,t.owner_id,t.due_on,t.status,t.reason AS notes,t.created_at,t.completed_at,t.interaction_id AS related_record_id
  FROM cf_call_tasks t JOIN members m ON m.id=t.donor_id
 UNION ALL SELECT t.id,s.donor_id,'recurring',s.title,s.owner_id,t.due_on,t.status,t.notes,t.created_at,t.completed_at,s.id
  FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id JOIN members m ON m.id=s.donor_id
 UNION ALL SELECT t.id,p.donor_id,'cultivation',t.title,t.owner_id,t.due_on,t.status,t.notes,t.created_at,t.completed_on,p.id
  FROM cf_cultivation_tasks t JOIN cf_prospects p ON p.id=t.prospect_id JOIN members m ON m.id=p.donor_id),
 followups AS MATERIALIZED (SELECT t.id,g.donor_id,'grant',t.title,t.owner_id,t.due_on,t.status,t.notes,g.created_at,t.completed_on,g.id
  FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id JOIN members m ON m.id=g.donor_id
 UNION ALL SELECT t.id,a.donor_id,'receipt_address','Check receipt address',NULL,NULL,
   CASE WHEN t.completed_at IS NULL THEN 'open' ELSE 'done' END,t.resolution,t.created_at,t.completed_at,a.id
  FROM cf_receipt_address_tasks t JOIN cf_acks a ON a.id=t.letter_id JOIN members m ON m.id=a.donor_id
 UNION ALL SELECT t.id,t.donor_id,'reply',t.subject,t.owner_id,NULL,t.status,t.body,t.received_at,NULL,t.communication_id
  FROM cf_reply_tasks t JOIN members m ON m.id=t.donor_id)
 SELECT * FROM work UNION ALL SELECT * FROM followups`
