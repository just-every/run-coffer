import { guard, sql, type Context, type Row, type Stmt } from './db'

const pair = '((SELECT source FROM merge),(SELECT target FROM merge))'
const gifts = `SELECT id FROM cf_gifts WHERE donor_id IN ${pair}`
const pledges = `SELECT id FROM cf_pledges WHERE donor_id IN ${pair}`
const subscriptions = `SELECT id FROM cf_subscriptions WHERE donor_id IN ${pair}`
const custodyPair = `(SELECT source FROM merge UNION SELECT target FROM merge UNION SELECT donor_id FROM cf_donor_merges WHERE into_id IN ${pair})`
type Description = {table:string; keys:string[]; scope:string; restore:boolean; columns:string[]}
const owned = (table:string,scope=`n.donor_id IN ${pair}`,keys=['id'],restore=true) => ({table,keys,scope,restore})
// Only these server-owned identifiers may enter generated SQL. Tokens are never
// captured. Welcome work stays stopped and preference checks are invalidated.
const descriptions = [
 owned('cf_donor_recognition',undefined,['donor_id']), owned('cf_gift_recognition',`n.gift_id IN (SELECT id FROM cf_contribution_ledger WHERE donor_id IN ${pair})`,['gift_id']),
 owned('cf_organization_contacts',`n.organization_donor_id IN ${pair} OR n.contact_donor_id IN ${pair}`),
 owned('cf_donors',`n.id IN ${pair}`),
 // Include original households after a contact-field choice moves the survivor.
 // Household versions fence every later staff membership, head or override edit.
 owned('cf_households',`n.id IN (SELECT household_id FROM cf_donors WHERE id IN ${pair}
  UNION SELECT json_extract(value,'$.household_id') FROM cf_donor_merge_rows
   WHERE merge_id=(SELECT id FROM merge) AND phase='before' AND table_name='cf_donors')`),
 owned('cf_donor_merges',`n.donor_id IN ${pair} OR n.into_id IN ${pair}`,['donor_id']),
 owned('cf_donor_aliases',undefined,['donor_id','email']),
 owned('cf_donor_meetings'), owned('cf_donor_address_history'), owned('cf_record_documents'),
 owned('cf_gift_acknowledgments',`n.gift_id IN (${gifts})`,['gift_id']),
 owned('cf_gifts'), owned('cf_consents'), owned('cf_pledges'), owned('cf_acks'),
 // Original identities retain these records. The same union scope before and
 // after flattening aliases also fences a later inherited restriction edit.
 owned('cf_solicitation',`n.donor_id IN ${custodyPair}`,['donor_id'],false),
 owned('cf_solicitation_history',`n.donor_id IN ${custodyPair}`,['donor_id','version'],false),
 owned('cf_solicitation_asks',`n.donor_id IN ${custodyPair}`,['kind','run_id','donor_id'],false),
 owned('cf_solicitation_recipients',`n.donor_id IN ${custodyPair}`,['kind','run_id','donor_id'],false),
 owned('cf_solicitation_inclusions',`n.donor_id IN ${custodyPair}`,['kind','run_id','donor_id'],false),
 owned('cf_sms_preferences',`n.donor_id IN ${custodyPair}`),
 owned('cf_sms_recipients',`n.donor_id IN ${custodyPair}`,['run_id','donor_id'],false),
 owned('cf_sms_runs',`n.id IN (SELECT run_id FROM cf_sms_recipients WHERE donor_id IN ${custodyPair})`,['id'],false),
 owned('cf_donor_rule_tags',undefined,['donor_id','tag']),
 owned('cf_events',`n.donor_id IN ${pair} AND NOT (n.action IN ('donor.merge','donor.unmerge','solicitation.mergeCustody') AND COALESCE(json_extract(n.detail,'$.mergeId'),'')=(SELECT id FROM merge))`),
 owned('cf_soft_credits',`n.donor_id IN ${pair} OR n.gift_id IN (${gifts})`),
 owned('cf_tribute_notifications',`n.gift_id IN (${gifts})`,['id'],false),
 owned('cf_gift_tributes',`n.donor_id IN ${pair} OR n.gift_id IN (${gifts})`,['gift_id']),
 owned('cf_giving_customers',undefined,['customer_id']), owned('cf_giving_intents'),
 owned('cf_recurring_task_series'),
 owned('cf_recurring_tasks',`n.series_id IN (SELECT id FROM cf_recurring_task_series WHERE donor_id IN ${pair})`),
 owned('cf_subscriptions'), owned('cf_communications'), owned('cf_reply_tasks'), owned('cf_receipt_address_tasks',`n.letter_id IN (SELECT id FROM cf_acks WHERE donor_id IN ${pair})`,['id'],false), owned('cf_call_tasks'),
 owned('cf_employer_matches',`n.employer_donor_id IN ${pair} OR n.gift_id IN (${gifts}) OR n.received_gift_id IN (${gifts})`),
 owned('cf_relationships',`n.donor_id IN ${pair} OR n.related_donor_id IN ${pair}`),
 owned('cf_portfolio_members',undefined,['donor_id']), owned('cf_planned_gifts'), owned('cf_legacy_memberships'),
 owned('cf_planned_distributions',`n.intention_id IN (SELECT id FROM cf_planned_gifts WHERE donor_id IN ${pair}) OR n.gift_id IN (${gifts})`,['gift_id']),
 owned('cf_interactions'), owned('cf_donor_notes'),
 owned('cf_soft_credit_acknowledgments',`n.soft_credit_id IN (SELECT id FROM cf_soft_credits WHERE donor_id IN ${pair} OR gift_id IN (${gifts}))`,['soft_credit_id']),
 owned('cf_research_results'), owned('cf_volunteering'), owned('cf_in_kind_gifts'),
 owned('cf_in_kind_revisions',`n.in_kind_id IN (SELECT id FROM cf_in_kind_gifts WHERE donor_id IN ${pair})`,['id'],false),
 owned('cf_in_kind_acknowledgments',`n.in_kind_id IN (SELECT id FROM cf_in_kind_gifts WHERE donor_id IN ${pair})`),
 owned('cf_contribution_types',`n.gift_id IN (${gifts})`,['gift_id']),
 owned('cf_stock_contributions',`n.in_kind_id IN (SELECT id FROM cf_in_kind_gifts WHERE donor_id IN ${pair})`,['in_kind_id'],false),
 owned('cf_grants'),
 owned('cf_grant_documents',`n.grant_id IN (SELECT id FROM cf_grants WHERE donor_id IN ${pair})`),
 owned('cf_grant_tasks',`n.grant_id IN (SELECT id FROM cf_grants WHERE donor_id IN ${pair})`),
 owned('cf_prospects'),
 owned('cf_cultivation_tasks',`n.prospect_id IN (SELECT id FROM cf_prospects WHERE donor_id IN ${pair})`),
 owned('cf_proposals',`n.prospect_id IN (SELECT id FROM cf_prospects WHERE donor_id IN ${pair})`),
 owned('cf_appeal_recipients',undefined,['appeal_id','donor_id']), owned('cf_stewardship_drafts'),
 owned('cf_welcome_steps',undefined,['id'],false), owned('cf_welcome_enrollments',undefined,['donor_id'],false),
 owned('cf_preference_sync',undefined,['donor_id'],false),
 // Later uses of the moved records also fence undo, even without donor versions.
 owned('cf_pledge_adjustments',`n.pledge_id IN (${pledges})`,['id'],false),
 owned('cf_pledge_plans',`n.pledge_id IN (${pledges})`,['pledge_id'],false),
 owned('cf_pledge_installments',`n.pledge_id IN (${pledges})`,['id'],false),
 owned('cf_pledge_allocations',`n.gift_id IN (${gifts}) OR n.installment_id IN (SELECT id FROM cf_pledge_installments WHERE pledge_id IN (${pledges}))`,['id'],false),
 owned('cf_gift_allocations',`n.gift_id IN (${gifts})`,['id'],false),
 owned('cf_refund_requests',`n.gift_id IN (${gifts})`,['id'],false),
 owned('cf_payment_disputes',`n.gift_id IN (${gifts})`,['id'],false),
 owned('cf_payment_notices',`n.gift_id IN (${gifts})`,['id'],false),
 owned('cf_payment_entries',`n.gift_id IN (${gifts})`,['id'],false),
 owned('cf_campaign_gifts',`n.gift_id IN (${gifts})`,['gift_id'],false),
 owned('cf_subscription_gifts',`n.gift_id IN (${gifts}) OR n.subscription_id IN (${subscriptions})`,['gift_id'],false),
 owned('cf_agent_recovery',`n.subscription_id IN (${subscriptions})`,['invoice_id'],false),
 owned('cf_stewardship_versions',`n.draft_id IN (SELECT id FROM cf_stewardship_drafts WHERE donor_id IN ${pair})`,['draft_id','version'],false),
 owned('cf_move_in_records',`n.donor_id IN ${pair} OR n.related_id IN ${pair}`,['source','kind','source_key'],false),
 owned('cf_move_in_job_gifts',`n.gift_id IN (${gifts})`,['job_id','gift_id'],false),
 owned('cf_import_revisions',`(n.kind='donor' AND n.id IN ${pair}) OR (n.kind='gift' AND n.id IN (${gifts})) OR (n.kind='subscription' AND n.id IN (${subscriptions}))`,['kind','id'],false),
]
const mergeCTE = 'merge AS (SELECT id,source_id AS source,target_id AS target FROM cf_donor_merge_journal WHERE id=?)'
const keySQL = (d:Description,alias='n') => `json_array(${d.keys.map(k=>`${alias}.${k}`).join(',')})`
const valueSQL = (d:Description,alias='n') => `json_object(${d.columns.map(k=>`'${k}',${alias}.${k}`).join(',')})`

/** Inspect only named product tables, so a later added column is protected by
 * the same exact-state fence without maintaining a second copy of its schema. */
export async function journalTables(c: Pick<Context,'db'>): Promise<Description[]> {
 const schemas = await c.db.batch(descriptions.map(d=>c.db.prepare(`PRAGMA table_info(${d.table})`)))
 return descriptions.map((d,i)=>({...d,columns:(schemas[i].results as Row[]).map(r=>String(r.name))}))
}

export function captureMerge(tables:Description[],mergeId:string,phase:'before'|'after'): Stmt[] {
 return tables.map(d=>sql(`WITH ${mergeCTE}
  INSERT INTO cf_donor_merge_rows(merge_id,phase,table_name,row_key,value)
  SELECT ?,?,?,${keySQL(d)},${valueSQL(d)} FROM ${d.table} n WHERE ${d.scope}`,mergeId,mergeId,phase,d.table))
}

export function unchangedMerge(tables:Description[],mergeId:string): Stmt[] {
 return tables.map(d=>guard(`(WITH ${mergeCTE},
  live AS (SELECT ${keySQL(d)} AS row_key,${valueSQL(d)} AS value FROM ${d.table} n WHERE ${d.scope}),
  saved AS (SELECT row_key,value FROM cf_donor_merge_rows WHERE merge_id=? AND phase='after' AND table_name=?)
  SELECT NOT EXISTS(SELECT 1 FROM live LEFT JOIN saved USING(row_key) WHERE saved.row_key IS NULL OR live.value<>saved.value)
  AND NOT EXISTS(SELECT 1 FROM saved LEFT JOIN live USING(row_key) WHERE live.row_key IS NULL))`,
  'MERGE_CHANGED','These records changed after the merge. Nothing was undone.',mergeId,mergeId,d.table))
}

/** Restore only the merge's own delta. New gifts and edits can never be moved
 * wholesale to the source. Common rows update in place to preserve child FKs;
 * rows removed during collision reconciliation are then inserted unchanged. */
export function restoreMerge(tables:Description[],mergeId:string): Stmt[] {
 const statements:Stmt[] = []
 // Keep the source merge alias until contact values have been restored, so its
 // retained email does not conflict with the survivor's temporarily chosen one.
 const ordered = [...tables.filter(d=>d.restore && d.table!=='cf_donor_merges'),...tables.filter(d=>d.table==='cf_donor_merges')]
 for (const d of ordered) {
  const before = `before AS (SELECT row_key,value FROM cf_donor_merge_rows WHERE merge_id=? AND phase='before' AND table_name='${d.table}')`
  const after = `after AS (SELECT row_key,value FROM cf_donor_merge_rows WHERE merge_id=? AND phase='after' AND table_name='${d.table}')`
  const prefix = `WITH ${before},${after}`
  const liveKey = keySQL(d,d.table)
  statements.push(sql(`${prefix} DELETE FROM ${d.table} WHERE ${liveKey} IN (SELECT a.row_key FROM after a LEFT JOIN before b USING(row_key) WHERE b.row_key IS NULL)`,mergeId,mergeId))
  const changes = d.columns.filter(k=>!d.keys.includes(k)).map(k=>k==='version'
   ? `${k}=${d.table}.${k}+1`
   : `${k}=json_extract((SELECT value FROM before WHERE row_key=${liveKey}),'$.${k}')`)
  if (changes.length) statements.push(sql(`${prefix} UPDATE ${d.table} SET ${changes.join(',')}
   WHERE ${liveKey} IN (SELECT b.row_key FROM before b JOIN after a USING(row_key) WHERE b.value<>a.value)`,mergeId,mergeId))
  statements.push(sql(`${prefix} INSERT INTO ${d.table}(${d.columns.join(',')})
   SELECT ${d.columns.map(k=>`json_extract(b.value,'$.${k}')`).join(',')} FROM before b LEFT JOIN after a USING(row_key) WHERE a.row_key IS NULL`,mergeId,mergeId))
 }
 return statements
}

/** Ordered undo of a later merge restores an earlier merge's exact values, but
 * native versions must keep increasing. Advance an older checkpoint only when
 * it exactly matched this merge's BEFORE row, proving no intervening edit was
 * being forgiven. This never changes import custody or an earlier before row. */
export function advanceEarlierMergeVersions(tables:Description[],mergeId:string):Stmt[] {
 return tables.filter(d=>d.restore && d.columns.includes('version')).map(d=>sql(`
  UPDATE cf_donor_merge_rows AS prior SET value=(SELECT ${valueSQL(d)} FROM ${d.table} n WHERE ${keySQL(d)}=prior.row_key)
  WHERE prior.phase='after' AND prior.table_name=? AND prior.merge_id<>?
   AND prior.merge_id IN (SELECT id FROM cf_donor_merge_journal WHERE status='active')
   AND EXISTS(SELECT 1 FROM cf_donor_merge_rows b JOIN ${d.table} n ON ${keySQL(d)}=b.row_key
    WHERE b.merge_id=? AND b.phase='before' AND b.table_name=prior.table_name AND b.row_key=prior.row_key
     AND b.value=prior.value AND json_remove(${valueSQL(d)},'$.version')=json_remove(b.value,'$.version'))`,d.table,mergeId,mergeId))
}
