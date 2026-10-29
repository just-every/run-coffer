/** Server-owned table descriptions. Never accept SQL identifiers from an upload. */
export const tables = {
 household: { table: 'cf_households', key: 'id', columns: ['id','version','name','created_at','head_donor_id','addressee_override','formal_override','informal_override','overrides_review','head_source','head_imported_at'] },
 donor: { table: 'cf_donors', key: 'id', columns: ['id','version','name','prefix','first_name','middle_name','last_name','suffix','nickname','constituent_kind','constituent_status','informal_salutation','formal_salutation','envelope_name','status_reason','deceased_on','status_changed_at','status_changed_by','email','phone','address_line1','address_line2','city','region','postal_code','country','household_id','source','source_ref','created_at','erased_at'] },
 contact: { table:'cf_contact_points',key:'id',columns:['id','donor_id','kind','type','value','active','is_primary','starts_on','ends_on','version','source','source_on','updated_at'] },
 solicitation: { table:'cf_solicitation',key:'donor_id',columns:['period','donor_id','version','type','starts_on','ends_on','channels','max_asks','source','source_ref','source_on','recorded_at','recorded_by_id','recorded_by_name'] },
 consent: { table:'cf_consents',key:'id',columns:['id','donor_id','channel','status','method','evidence','captured_on','recorded_at','recorded_by'] },
 recognition: { table:'cf_donor_recognition',key:'donor_id',columns:['donor_id','anonymous','recognition_name','honor_roll_opt_in','version'] },
 pledge: { table: 'cf_pledges', key: 'id', columns: ['id','donor_id','amount_cents','pledged_on','due_by','fund','created_at','created_by','api_review_required'] },
 installment: { table: 'cf_pledge_installments', key: 'id', columns: ['id','pledge_id','position','due_on','amount_cents','remind_on','reminder_status'] },
 gift: { table: 'cf_gifts', key: 'id', columns: ['id','version','donor_id','kind','reverses','received_on','amount_cents','method','reference','fund','pledge_id','goods','goods_cents','goods_description','note','source','created_at','created_by'] },
 tribute: { table: 'cf_gift_tributes', key: 'gift_id', columns: ['gift_id','version','kind','honoree','notified_name','notified_email','notified_address','amount_permission','group_key','source_group','donor_id','created_at','created_by'] },
 recurringReference: {table:'cf_recurring_source_references',key:'id',columns:['id','donor_id','source','source_id','amount_cents','frequency','status','method','campaign','next_on','customer_reference','payment_method_reference','imported_at']},
 membership: {table:'cf_source_memberships',key:'id',columns:['id','donor_id','source','source_id','level_id','level_name','term_name','starts_on','ends_on','status','fee_cents','gift_id','source_auto_renewal','source_active','imported_at']},
 platformGift: {table:'cf_platform_gifts',key:'gift_id',columns:['gift_id','source','source_id','campaign_id','campaign_name','fee_cents']},
 campaign: { table: 'cf_gift_appeals', key: 'gift_id', columns: ['gift_id','appeal'] },
 channel: { table: 'cf_gift_channels', key: 'gift_id', columns: ['gift_id','channel'] },
 allocation: { table: 'cf_pledge_allocations', key: 'id', columns: ['id','installment_id','gift_id','amount_cents','created_at','created_by'] },
 relationship: { table: 'cf_relationships', key: 'id', columns: ['id','donor_id','related_donor_id','type','created_at','created_by'] },
 softCredit: { table: 'cf_soft_credits', key: 'id', columns: ['id','gift_id','donor_id','amount_cents','created_at','created_by'] },
 note: { table: 'cf_donor_notes', key: 'id', columns: ['id','donor_id','occurred_on','body','source','recorded_at','recorded_by'] },
 interaction: { table: 'cf_interactions', key: 'id', columns: ['id','donor_id','kind','occurred_on','who','notes','next_step','recorded_at','recorded_by'] },
 acknowledgment: { table: 'cf_gift_acknowledgments', key: 'gift_id', columns: ['gift_id','version','status','acknowledged_on','method','batch_id','letter_id','interaction_id','note_id','communication_id','outcome_unknown','reason','source_reference','source','updated_at','updated_by','updated_by_id','updated_by_role','change_source'] },
 softCreditAcknowledgment: { table: 'cf_soft_credit_acknowledgments', key: 'soft_credit_id', columns: ['soft_credit_id','version','status','acknowledged_on','method','interaction_id','note_id','reason','updated_at','updated_by','source','source_reference'] },
} as const
export type Kind = keyof typeof tables
export const kinds = Object.keys(tables) as Kind[]
export const snapshot = (kind: Kind, alias = 'n') => `json_object(${tables[kind].columns.map(column => `'${column}',${alias}.${column}`).join(',')})`

/** Older import snapshots predate the acknowledgment custody columns. Their
 * implicit database defaults still fence any later version or linked record. */
export const custodySnapshot = (kind: Kind, alias = 'r') => {
 if(kind==='pledge')return `json_set(${alias}.snapshot,'$.api_review_required',COALESCE(json_extract(${alias}.snapshot,'$.api_review_required'),0))`
 if (kind !== 'acknowledgment') return `${alias}.snapshot`
 const defaults: Record<string,string> = {version:'1',outcome_unknown:'0',updated_by_id:"'coffer-import'",updated_by_role:"'owner'",change_source:"'automatic'"}
 return `json_object(${tables.acknowledgment.columns.map(column => {
  const value = `json_extract(${alias}.snapshot,'$.${column}')`
  return `'${column}',${defaults[column] ? `COALESCE(${value},${defaults[column]})` : value}`
 }).join(',')})`
}
