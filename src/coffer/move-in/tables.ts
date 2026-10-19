/** Server-owned table descriptions. Never accept SQL identifiers from an upload. */
export const tables = {
 household: { table: 'cf_households', key: 'id', columns: ['id','name','created_at'] },
 donor: { table: 'cf_donors', key: 'id', columns: ['id','version','name','email','phone','address_line1','address_line2','city','region','postal_code','country','household_id','source','source_ref','created_at','erased_at'] },
 pledge: { table: 'cf_pledges', key: 'id', columns: ['id','donor_id','amount_cents','pledged_on','due_by','fund','created_at','created_by'] },
 installment: { table: 'cf_pledge_installments', key: 'id', columns: ['id','pledge_id','position','due_on','amount_cents','remind_on','reminder_status'] },
 gift: { table: 'cf_gifts', key: 'id', columns: ['id','version','donor_id','kind','reverses','received_on','amount_cents','method','reference','fund','pledge_id','goods','goods_cents','goods_description','note','source','created_at','created_by'] },
 acknowledgment: { table: 'cf_gift_acknowledgments', key: 'gift_id', columns: ['gift_id','status','acknowledged_on','method','batch_id','letter_id','reason','source','updated_at','updated_by'] },
 campaign: { table: 'cf_gift_appeals', key: 'gift_id', columns: ['gift_id','appeal'] },
 channel: { table: 'cf_gift_channels', key: 'gift_id', columns: ['gift_id','channel'] },
 allocation: { table: 'cf_pledge_allocations', key: 'id', columns: ['id','installment_id','gift_id','amount_cents','created_at','created_by'] },
 relationship: { table: 'cf_relationships', key: 'id', columns: ['id','donor_id','related_donor_id','type','created_at','created_by'] },
 softCredit: { table: 'cf_soft_credits', key: 'id', columns: ['id','gift_id','donor_id','amount_cents','created_at','created_by'] },
 note: { table: 'cf_donor_notes', key: 'id', columns: ['id','donor_id','occurred_on','body','source','recorded_at','recorded_by'] },
 interaction: { table: 'cf_interactions', key: 'id', columns: ['id','donor_id','kind','occurred_on','who','notes','next_step','recorded_at','recorded_by'] },
} as const
export type Kind = keyof typeof tables
export const kinds = Object.keys(tables) as Kind[]
export const snapshot = (kind: Kind, alias = 'n') => `json_object(${tables[kind].columns.map(column => `'${column}',${alias}.${column}`).join(',')})`
