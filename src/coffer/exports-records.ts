import { taskRecords } from './exports-tasks'
/** Each projection is an explicit custody boundary. Never serialize a storage
 * row wholesale: those rows can also hold provider and payment credentials. */
export const EXPORT_TYPES = ['constituents','gifts','pledges','plans','consent','interactions','tasks','opportunities'] as const
export type ExportType = typeof EXPORT_TYPES[number]
type RecordSpec = { columns: string[]; query: string }
const columns = (value: string) => value.split(' ')

const constituentColumns = columns('id version name prefix first_name middle_name last_name suffix nickname constituent_kind organization_type website ein email phone address_line1 address_line2 city region postal_code country household_id informal_salutation formal_salutation envelope_name constituent_status status_reason deceased_on status_changed_at created_at')
const giftColumns = columns('id donor_id kind received_on amount_cents gross_cents adjustment_cents refunded_cents stated_value_cents description quantity fund campaign_id allocations method pledge_id created_at custom_fields acknowledgment_status acknowledged_on acknowledgment_method acknowledgment_link')
const pledgeColumns = columns('id donor_id version pledged_on due_by amount_cents reduced_cents paid_cents remaining_cents fund campaign_id created_at custom_fields')
const planColumns = columns('id donor_id campaign_id amount_cents billing_interval interval_count collection_paused status cancel_at_period_end failed_attempts recovered started_at start_known ended_at failed_invoice_count recovered_invoice_count updated_at')
const consentColumns = columns('id donor_id channel status method evidence captured_on recorded_at recorded_by')
const interactionBase = columns('id donor_id kind occurred_on who notes next_step open_question question_resolved_at recorded_at recorded_by')
const interactionColumns=[...interactionBase,'custom_fields']
const taskColumns = columns('id donor_id task_kind title owner_id due_on status notes created_at completed_at related_record_id')
const opportunityColumns = columns('id donor_id version label stage owner_id ask_amount_cents expected_amount_cents probability_percent weighted_cents expected_close_on next_step fund campaign_id pledge_id gift_id closed_on created_at updated_at custom_fields')

const customValues=(kind:string,record:string)=>`(SELECT json_group_object(v.field_key,json(v.value)) FROM cf_custom_values v JOIN cf_custom_fields f ON f.key=v.field_key WHERE f.kind='${kind}' AND v.record_id=${record})`

const netGift = `CASE WHEN EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id) THEN 0
 ELSE g.amount_cents+COALESCE((SELECT SUM(p.contribution_cents) FROM cf_payment_entries p WHERE p.gift_id=g.id),0) END`
const pledgePaid = `COALESCE((SELECT SUM(g.amount_cents-CASE WHEN g.kind='reversal' THEN -1 ELSE 1 END*
 COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_active_allocations a WHERE a.gift_id=COALESCE(g.reverses,g.id)),0))
 FROM cf_monetary_contributions g WHERE g.pledge_id=p.id),0)+
 COALESCE((SELECT SUM(i.paid_cents) FROM cf_pledge_balances i WHERE i.pledge_id=p.id),0)`

export const exportRecords: Record<ExportType, RecordSpec> = {
 constituents: {columns:[...constituentColumns,'contact_points','custom_fields','tags','solicitation_restrictions','computed_informal_salutation','computed_formal_salutation','computed_envelope_name'],
  query:`SELECT ${constituentColumns.map(k=>`d.${k}`).join(',')},(SELECT json_group_array(json_object('id',p.id,'kind',p.kind,'type',p.type,'value',p.value,'primary',p.is_primary,'starts_on',p.starts_on,'ends_on',p.ends_on,'version',p.version,'source',p.source,'source_on',p.source_on)) FROM cf_contact_points p WHERE p.donor_id=d.id AND p.active=1) AS contact_points,(SELECT json_group_object(v.field_key,json(v.value)) FROM cf_custom_values v JOIN cf_custom_fields f ON f.key=v.field_key WHERE f.kind='constituent' AND v.record_id=d.id) AS custom_fields,(SELECT json_group_array(tag) FROM cf_donor_tags WHERE donor_id=d.id) AS tags,(SELECT json_group_array(json_object('original_donor_id',s.donor_id,'type',s.type,'starts_on',s.starts_on,'ends_on',s.ends_on,'channels',json(s.channels),'max_asks',s.max_asks,'period',s.period,'source',s.source,'source_on',s.source_on,'version',s.version)) FROM cf_solicitation s WHERE s.type<>'none' AND (s.donor_id=d.id OR EXISTS(SELECT 1 FROM cf_donor_merges sm WHERE sm.donor_id=s.donor_id AND sm.into_id=d.id))) AS solicitation_restrictions,NULL AS computed_informal_salutation,NULL AS computed_formal_salutation,NULL AS computed_envelope_name
   FROM cf_donors d JOIN members m ON m.id=d.id`},
 gifts: {columns:giftColumns,query:`SELECT g.id,g.donor_id,'gift' AS kind,g.received_on,${netGift} AS amount_cents,
  COALESCE(ir.gross_cents,g.amount_cents) AS gross_cents,
  ${netGift}-COALESCE(ir.gross_cents,g.amount_cents) AS adjustment_cents,COALESCE(ir.refunded_cents,0) AS refunded_cents,
  NULL AS stated_value_cents,NULL AS description,NULL AS quantity,g.fund,
  (SELECT campaign_id FROM cf_campaign_gifts WHERE gift_id=g.id) AS campaign_id,
  (SELECT json_group_array(json_object('fund',a.fund,'campaign_id',a.campaign_id,'amount_cents',a.amount_cents,
   'net_cents',COALESCE((SELECT SUM(f.amount_cents) FROM cf_fund_ledger f WHERE f.gift_id=g.id AND f.position=a.position),0)))
   FROM (SELECT * FROM cf_gift_allocations WHERE gift_id=g.id ORDER BY position) a) AS allocations,
  g.method,g.pledge_id,g.created_at,${customValues('gift','g.id')} AS custom_fields FROM cf_gifts g JOIN members m ON m.id=g.donor_id
  LEFT JOIN cf_import_refunds ir ON ir.gift_id=g.id WHERE g.kind='gift'
  UNION ALL SELECT g.id,g.donor_id,'in_kind',g.received_on,0,0,0,0,g.stated_value_cents,g.description,g.quantity,g.fund,
   NULL,'[]','in_kind',NULL,g.created_at,${customValues('gift','g.id')} FROM cf_in_kind_current g JOIN members m ON m.id=g.donor_id`},
 pledges: {columns:pledgeColumns,query:`SELECT p.id,p.donor_id,p.version,p.pledged_on,p.due_by,p.amount_cents,p.reduced_cents,
  ${pledgePaid} AS paid_cents,MAX(0,p.amount_cents-p.reduced_cents-(${pledgePaid})) AS remaining_cents,
  p.fund,p.campaign_id,p.created_at,${customValues('pledge','p.id')} AS custom_fields FROM cf_pledge_totals p JOIN members m ON m.id=p.donor_id`},
 plans: {columns:planColumns,query:`SELECT ${planColumns.map(k=>k==='failed_invoice_count'?"(SELECT COUNT(*) FROM cf_recurring_payment_health p WHERE p.subscription_id=s.id) AS failed_invoice_count":k==='recovered_invoice_count'?"(SELECT COUNT(*) FROM cf_recurring_payment_health p WHERE p.subscription_id=s.id AND p.recovered_at IS NOT NULL) AS recovered_invoice_count":k==='started_at'||k==='start_known'?`l.${k}`:['billing_interval','interval_count','collection_paused'].includes(k)?`latest.${k}`:k==='ended_at'?"(SELECT MIN(observed_at) FROM cf_subscription_history h WHERE h.subscription_id=s.id AND h.status IN ('canceled','incomplete_expired')) AS ended_at":`s.${k}`).join(',')}
  FROM cf_subscriptions s JOIN members m ON m.id=s.donor_id LEFT JOIN cf_subscription_lifetimes l ON l.subscription_id=s.id
  LEFT JOIN cf_subscription_history latest ON latest.sequence=(SELECT sequence FROM cf_subscription_history h WHERE h.subscription_id=s.id ORDER BY observed_at DESC,sequence DESC LIMIT 1)`},
 consent: {columns:consentColumns,query:`SELECT ${consentColumns.map(k=>`k.${k}`).join(',')} FROM cf_consents k JOIN members m ON m.id=k.donor_id
  WHERE k.id=(SELECT MAX(latest.id) FROM cf_consents latest WHERE latest.donor_id=k.donor_id AND latest.channel=k.channel)`},
 interactions: {columns:interactionColumns,query:`SELECT ${interactionBase.map(k=>`i.${k}`).join(',')},${customValues('interaction','i.id')} AS custom_fields FROM cf_interactions i JOIN members m ON m.id=i.donor_id
  UNION ALL SELECT n.id,n.donor_id,n.kind,n.occurred_on,n.who,n.body,n.next_step,NULL,NULL,n.recorded_at,n.recorded_by,${customValues('note','n.id')}
  FROM cf_donor_notes n JOIN members m ON m.id=n.donor_id WHERE n.confidential=0`},
 tasks: {columns:taskColumns,query:taskRecords},
 opportunities: {columns:opportunityColumns,query:`SELECT p.id,p.donor_id,p.version,p.label,p.stage,p.owner_id,p.ask_amount_cents,p.expected_amount_cents,p.probability_percent,
  (p.expected_amount_cents*p.probability_percent+50)/100 AS weighted_cents,p.expected_close_on,p.next_step,p.fund,p.campaign_id,p.pledge_id,p.gift_id,p.closed_on,p.created_at,p.updated_at,${customValues('opportunity','p.id')} AS custom_fields
  FROM cf_prospects p JOIN members m ON m.id=p.donor_id`},
}

export const recordJson = (type: ExportType) => `json_object(${exportRecords[type].columns.flatMap(k=>[`'${k}'`,`r.${k}`]).join(',')})`

const giftQuery=exportRecords.gifts.query
exportRecords.gifts.query=`SELECT gr.*,
 COALESCE(ga.status,CASE WHEN EXISTS(SELECT 1 FROM cf_prior_acknowledgements ap WHERE ap.gift_id=gr.id) THEN 'acknowledged' ELSE 'not acknowledged' END) AS acknowledgment_status,
 ga.acknowledged_on,ga.method AS acknowledgment_method,
 CASE WHEN ga.letter_id IS NOT NULL THEN json_object('kind','letter','id',ga.letter_id,'batchId',ga.batch_id)
 WHEN ga.communication_id IS NOT NULL THEN json_object('kind','message','id',ga.communication_id)
 WHEN ga.interaction_id IS NOT NULL THEN json_object('kind','interaction','id',ga.interaction_id)
 WHEN ga.note_id IS NOT NULL THEN json_object('kind','note','id',ga.note_id)
 WHEN ga.source_reference IS NOT NULL THEN json_object('kind','source','id',ga.source_reference) ELSE NULL END AS acknowledgment_link
 FROM (${giftQuery}) gr LEFT JOIN cf_gift_acknowledgments ga ON ga.gift_id=gr.id`
