/** Each projection is an explicit custody boundary. Never serialize a storage
 * row wholesale: those rows can also hold provider and payment credentials. */
export const EXPORT_TYPES = ['constituents','gifts','pledges','plans','consent','interactions','tasks','opportunities'] as const
export type ExportType = typeof EXPORT_TYPES[number]
type RecordSpec = { columns: string[]; query: string }
const columns = (value: string) => value.split(' ')

const constituentColumns = columns('id version name prefix first_name middle_name last_name suffix nickname constituent_kind organization_type website ein email phone address_line1 address_line2 city region postal_code country household_id informal_salutation formal_salutation envelope_name constituent_status status_reason deceased_on status_changed_at created_at')
const giftColumns = columns('id donor_id kind received_on amount_cents gross_cents adjustment_cents refunded_cents stated_value_cents description quantity fund campaign_id allocations method pledge_id created_at')
const pledgeColumns = columns('id donor_id version pledged_on due_by amount_cents reduced_cents paid_cents remaining_cents fund campaign_id created_at')
const planColumns = columns('id donor_id campaign_id amount_cents status cancel_at_period_end failed_attempts recovered updated_at')
const consentColumns = columns('id donor_id channel status method evidence captured_on recorded_at recorded_by')
const interactionColumns = columns('id donor_id kind occurred_on who notes next_step open_question question_resolved_at recorded_at recorded_by')
const taskColumns = columns('id donor_id task_kind title owner_id due_on status notes created_at completed_at related_record_id')
const opportunityColumns = columns('id donor_id version label stage owner_id ask_amount_cents expected_amount_cents probability_percent weighted_cents expected_close_on next_step fund campaign_id pledge_id gift_id closed_on created_at updated_at')

const netGift = `CASE WHEN EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id) THEN 0
 ELSE g.amount_cents+COALESCE((SELECT SUM(p.contribution_cents) FROM cf_payment_entries p WHERE p.gift_id=g.id),0) END`
const pledgePaid = `COALESCE((SELECT SUM(g.amount_cents-CASE WHEN g.kind='reversal' THEN -1 ELSE 1 END*
 COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_allocations a WHERE a.gift_id=COALESCE(g.reverses,g.id)),0))
 FROM cf_monetary_contributions g WHERE g.pledge_id=p.id),0)+
 COALESCE((SELECT SUM(i.paid_cents) FROM cf_pledge_balances i WHERE i.pledge_id=p.id),0)`

export const exportRecords: Record<ExportType, RecordSpec> = {
 constituents: {columns:[...constituentColumns,'computed_informal_salutation','computed_formal_salutation','computed_envelope_name'],
  query:`SELECT ${constituentColumns.map(k=>`d.${k}`).join(',')},NULL AS computed_informal_salutation,NULL AS computed_formal_salutation,NULL AS computed_envelope_name
   FROM cf_donors d JOIN members m ON m.id=d.id`},
 gifts: {columns:giftColumns,query:`SELECT g.id,g.donor_id,'gift' AS kind,g.received_on,${netGift} AS amount_cents,
  COALESCE(ir.gross_cents,g.amount_cents) AS gross_cents,
  ${netGift}-COALESCE(ir.gross_cents,g.amount_cents) AS adjustment_cents,COALESCE(ir.refunded_cents,0) AS refunded_cents,
  NULL AS stated_value_cents,NULL AS description,NULL AS quantity,g.fund,
  (SELECT campaign_id FROM cf_campaign_gifts WHERE gift_id=g.id) AS campaign_id,
  (SELECT json_group_array(json_object('fund',a.fund,'campaign_id',a.campaign_id,'amount_cents',a.amount_cents,
   'net_cents',COALESCE((SELECT SUM(f.amount_cents) FROM cf_fund_ledger f WHERE f.gift_id=g.id AND f.position=a.position),0)))
   FROM (SELECT * FROM cf_gift_allocations WHERE gift_id=g.id ORDER BY position) a) AS allocations,
  g.method,g.pledge_id,g.created_at FROM cf_gifts g JOIN members m ON m.id=g.donor_id
  LEFT JOIN cf_import_refunds ir ON ir.gift_id=g.id WHERE g.kind='gift'
  UNION ALL SELECT g.id,g.donor_id,'in_kind',g.received_on,0,0,0,0,g.stated_value_cents,g.description,g.quantity,g.fund,
   NULL,'[]','in_kind',NULL,g.created_at FROM cf_in_kind_current g JOIN members m ON m.id=g.donor_id`},
 pledges: {columns:pledgeColumns,query:`SELECT p.id,p.donor_id,p.version,p.pledged_on,p.due_by,p.amount_cents,p.reduced_cents,
  ${pledgePaid} AS paid_cents,MAX(0,p.amount_cents-p.reduced_cents-(${pledgePaid})) AS remaining_cents,
  p.fund,p.campaign_id,p.created_at FROM cf_pledge_totals p JOIN members m ON m.id=p.donor_id`},
 plans: {columns:planColumns,query:`SELECT ${planColumns.map(k=>`s.${k}`).join(',')} FROM cf_subscriptions s JOIN members m ON m.id=s.donor_id`},
 consent: {columns:consentColumns,query:`SELECT ${consentColumns.map(k=>`k.${k}`).join(',')} FROM cf_consents k JOIN members m ON m.id=k.donor_id
  WHERE k.id=(SELECT MAX(latest.id) FROM cf_consents latest WHERE latest.donor_id=k.donor_id AND latest.channel=k.channel)`},
 interactions: {columns:interactionColumns,query:`SELECT ${interactionColumns.map(k=>`i.${k}`).join(',')} FROM cf_interactions i JOIN members m ON m.id=i.donor_id
  UNION ALL SELECT n.id,n.donor_id,n.kind,n.occurred_on,n.who,n.body,n.next_step,NULL,NULL,n.recorded_at,n.recorded_by
  FROM cf_donor_notes n JOIN members m ON m.id=n.donor_id WHERE n.confidential=0`},
 tasks: {columns:taskColumns,query:`SELECT t.id,t.donor_id,'call' AS task_kind,'Call' AS title,t.owner_id,t.due_on,t.status,t.reason AS notes,t.created_at,t.completed_at,t.interaction_id AS related_record_id
  FROM cf_call_tasks t JOIN members m ON m.id=t.donor_id
  UNION ALL SELECT t.id,s.donor_id,'recurring',s.title,s.owner_id,t.due_on,t.status,t.notes,t.created_at,t.completed_at,s.id
  FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id JOIN members m ON m.id=s.donor_id
  UNION ALL SELECT t.id,p.donor_id,'cultivation',t.title,t.owner_id,t.due_on,t.status,t.notes,t.created_at,t.completed_on,p.id
  FROM cf_cultivation_tasks t JOIN cf_prospects p ON p.id=t.prospect_id JOIN members m ON m.id=p.donor_id
  UNION ALL SELECT t.id,g.donor_id,'grant',t.title,t.owner_id,t.due_on,t.status,t.notes,g.created_at,t.completed_on,g.id
  FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id JOIN members m ON m.id=g.donor_id
  UNION ALL SELECT t.id,a.donor_id,'receipt_address','Check receipt address',NULL,NULL,
   CASE WHEN t.completed_at IS NULL THEN 'open' ELSE 'done' END,t.resolution,t.created_at,t.completed_at,a.id
  FROM cf_receipt_address_tasks t JOIN cf_acks a ON a.id=t.letter_id JOIN members m ON m.id=a.donor_id
  UNION ALL SELECT t.id,t.donor_id,'reply',t.subject,t.owner_id,NULL,t.status,t.body,t.received_at,NULL,t.communication_id
  FROM cf_reply_tasks t JOIN members m ON m.id=t.donor_id`},
 opportunities: {columns:opportunityColumns,query:`SELECT p.id,p.donor_id,p.version,p.label,p.stage,p.owner_id,p.ask_amount_cents,p.expected_amount_cents,p.probability_percent,
  (p.expected_amount_cents*p.probability_percent+50)/100 AS weighted_cents,p.expected_close_on,p.next_step,p.fund,p.campaign_id,p.pledge_id,p.gift_id,p.closed_on,p.created_at,p.updated_at
  FROM cf_prospects p JOIN members m ON m.id=p.donor_id`},
}

export const recordJson = (type: ExportType) => `json_object(${exportRecords[type].columns.flatMap(k=>[`'${k}'`,`r.${k}`]).join(',')})`
