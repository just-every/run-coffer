import { mergeStatements as recognitionMergeStatements } from './recognition'
import { solicitationCustodyGuards, solicitationMergeCustody } from './solicitation-custody'
import { reassignmentReason } from './reassignment-reasons'
import { requireRole } from './auth'
import { majorGiftMergeStatements } from './major-gifts'
import { donorDepthMergeStatements } from './donor-depth'
import { MERGE_FIELDS } from './duplicates'
import { addressMove, stageAddressMove } from './address-history'
import { advanceEarlierMergeVersions, captureMerge, journalTables, restoreMerge, unchangedMerge } from './merge-journal'
import { all, commit, event, fail, guard, id, integer, newId, object, one, sql, type Context, type Row, type Stmt } from './db'

export async function canonicalDonor(c: { db: D1Database }, donorId: string): Promise<string> {
 const merge = await one(c, 'SELECT into_id FROM cf_donor_merges WHERE donor_id=?', donorId)
 return merge?.into_id ?? donorId
}

/** Shared household addresses need a person, never SQLite's first result. */
export async function lookupEmailDonor(c:{db:D1Database}, email:string, name?:string):Promise<Row|null> {
 const rows = await all(c,`SELECT DISTINCT owner.* FROM (
  SELECT id AS donor_id,email FROM cf_donors UNION SELECT donor_id,email FROM cf_donor_aliases
 ) a LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id
 JOIN cf_donors owner ON owner.id=COALESCE(m.into_id,a.donor_id)
 WHERE a.email=? AND owner.erased_at IS NULL`,email.trim().toLowerCase())
 if (rows.length <= 1) return rows[0] ?? null
 const named = name ? rows.filter(d=>String(d.name).trim().toLowerCase()===name.trim().toLowerCase()) : []
 if (named.length===1) return named[0]
 return fail('DONOR_MATCH_AMBIGUOUS','This email belongs to more than one donor. Match the donor by name or review the donor records before recording this gift.')
}

function quietCommunications(source:string,target:string):Stmt[] {
 return [
  guard(`NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.donor_id IN (?,?)
   AND (b.status='prepared' OR (b.status='approved' AND a.printed_at IS NULL AND a.delivery_status NOT IN ('submitted','delivered','bounced','complained'))))`,
   'IN_ACKNOWLEDGEMENT', 'Discard unsent prepared or approved letters for these donors before merging.', source,target),
  guard(`NOT EXISTS(SELECT 1 FROM cf_appeal_recipients r JOIN cf_appeals a ON a.id=r.appeal_id WHERE r.donor_id IN (?,?) AND a.status IN ('prepared','approved'))`, 'IN_APPEAL', 'Discard prepared or approved appeals for these donors before merging.',source,target),
  guard(`NOT EXISTS(SELECT 1 FROM cf_communications WHERE donor_id IN (?,?) AND status='preparing')
   AND NOT EXISTS(SELECT 1 FROM cf_welcome_steps WHERE donor_id IN (?,?) AND status='sending')
   AND NOT EXISTS(SELECT 1 FROM cf_stewardship_drafts WHERE donor_id IN (?,?) AND status='sending')
   AND NOT EXISTS(SELECT 1 FROM cf_pledge_installments i JOIN cf_pledges p ON p.id=i.pledge_id WHERE p.donor_id IN (?,?) AND i.reminder_status='sending')`,
   'MESSAGE_IN_PROGRESS','A message is being submitted for these donors. Wait for its saved result before merging.',source,target,source,target,source,target,source,target),
 ]
}

/** Both original identities and emails remain import aliases. The ledger keeps
 * amounts, dates and references; a private journal owns the reversible data. */
export async function mergeDonor(c: Context, p: Row): Promise<Row> {
 requireRole(c.actor,['owner','admin'],'merge donor records')
 const source = id(p.sourceDonorId, 'Source donor'), target = id(p.donorId, 'Surviving donor')
 if (source === target) fail('INPUT', 'Choose two different donor records.', 400)
 const sourceVersion = integer(p.sourceVersion, 'Source version', 1), version = integer(p.version, 'Surviving version', 1)
 const rows = await all(c,'SELECT * FROM cf_donors WHERE id IN (?,?)',source,target)
 const from = rows.find(r=>r.id===source), into = rows.find(r=>r.id===target)
 if (!from || !into || from.erased_at || into.erased_at) fail('DONOR_CHANGED','Choose two donors who have not been erased.')
 const picks = p.fields === undefined ? {} : object(p.fields,'Surviving fields')
 for (const [key,value] of Object.entries(picks)) if (!MERGE_FIELDS.some(([field])=>field===key) || !['source','target'].includes(String(value))) fail('INPUT','Choose the source or survivor for each contact field.',400)
 const selected = MERGE_FIELDS.map(([key,,column])=>(picks[key]==='source'?from:into)[column] ?? null)
 const householdId = selected[MERGE_FIELDS.findIndex(([key])=>key==='householdId')]
 const households = await all(c,'SELECT * FROM cf_households WHERE id IN (?,?)',from.household_id,into.household_id)
 const householdChanges = households.map(h=>{
  const nextHead = h.head_donor_id===source ? (householdId===h.id ? target : null)
   : h.head_donor_id===target && householdId!==h.id ? null : h.head_donor_id
  if (h.head_donor_id===source && nextHead===target && (into.constituent_kind!=='person' || into.constituent_status==='deceased')) fail('HOUSEHOLD_HEAD','The surviving donor must be a living person to carry household headship.')
  return {household:h,head:nextHead}
 })
 const reason = reassignmentReason('merge', p.reason)
 const mergeId = newId(), tables = await journalTables(c), mergedOn = await addressMove(c, undefined)
 const statements: Stmt[] = [
  guard(`(SELECT count(*) FROM cf_donors d WHERE (id=? AND version=? OR id=? AND version=?) AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))=2`, 'VERSION', 'A donor changed or was merged. Review both records again.', source,sourceVersion,target,version),
  ...households.map(h=>guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','VERSION','A household changed. Review both donor records again.',h.id,h.version)),
  ...quietCommunications(source,target),
  guard(`NOT EXISTS(SELECT 1 FROM cf_contribution_types t JOIN cf_gifts g ON g.id=t.gift_id JOIN cf_soft_credits a ON a.id=t.soft_credit_id WHERE (g.donor_id=? AND a.donor_id=?) OR (g.donor_id=? AND a.donor_id=?))`,'DAF_CREDIT_CONFLICT','A DAF sponsor and its advisor must retain distinct hard and soft credits. Resolve these records before merging.',source,target,target,source),
  ...solicitationCustodyGuards(source,target),
  guard("NOT EXISTS(SELECT 1 FROM cf_ncoa_members m JOIN cf_ncoa_runs r ON r.id=m.run_id WHERE m.donor_id IN(?,?) AND r.state IN('queued','processing'))",'IN_ADDRESS_PASS','Finish or disable the pending address pass before merging these donors.',source,target),
  guard(`NOT EXISTS(SELECT 1 FROM cf_employer_matches m JOIN cf_gifts g ON g.id=m.gift_id WHERE (m.employer_donor_id IN (?,?) AND g.donor_id IN (?,?))) AND NOT EXISTS(SELECT 1 FROM cf_employer_matches a JOIN cf_employer_matches b ON a.gift_id=b.gift_id WHERE a.employer_donor_id=? AND b.employer_donor_id=?)`, 'MATCH_CONFLICT', 'Resolve matching-gift promises between these records, or duplicate employer promises, before merging.', source,target,source,target,source,target),
  sql("INSERT INTO cf_donor_merge_journal(id,source_id,target_id,merged_at,merged_by,status) VALUES(?,?,?,?,?,'active')",mergeId,source,target,c.now,c.actor.name),
  ...captureMerge(tables,mergeId,'before'),
  sql('INSERT INTO cf_donor_merges VALUES(?,?,?,?)', source,target,c.now,c.actor.name),
  sql('UPDATE cf_donor_merges SET into_id=? WHERE into_id=?',target,source),
  sql('INSERT OR IGNORE INTO cf_donor_aliases(donor_id,email) SELECT id,email FROM cf_donors WHERE id IN (?,?) AND email IS NOT NULL',source,target),
  sql('DELETE FROM cf_organization_contacts WHERE (organization_donor_id=? AND contact_donor_id=?) OR (organization_donor_id=? AND contact_donor_id=?)',source,target,target,source),
  sql('DELETE FROM cf_organization_contacts WHERE organization_donor_id=? AND contact_donor_id IN (SELECT contact_donor_id FROM cf_organization_contacts WHERE organization_donor_id=?)',source,target),
  sql('DELETE FROM cf_organization_contacts WHERE contact_donor_id=? AND organization_donor_id IN (SELECT organization_donor_id FROM cf_organization_contacts WHERE contact_donor_id=?)',source,target),
  sql('UPDATE cf_organization_contacts SET is_primary=0 WHERE organization_donor_id=? AND EXISTS(SELECT 1 FROM cf_organization_contacts WHERE organization_donor_id=? AND is_primary=1)',source,target),
  sql('UPDATE cf_organization_contacts SET organization_donor_id=? WHERE organization_donor_id=?',target,source),
  sql('UPDATE cf_organization_contacts SET contact_donor_id=? WHERE contact_donor_id=?',target,source),
  ...stageAddressMove(target,mergedOn,'merge'),
  sql(`UPDATE cf_donors SET ${MERGE_FIELDS.map(([,,column])=>`${column}=?`).join(',')},version=version+1 WHERE id=?`,...selected,target),
  ...(picks.name==='source'?[sql('UPDATE cf_donors SET prefix=?,first_name=?,middle_name=?,last_name=?,suffix=?,nickname=? WHERE id=?',from.prefix,from.first_name,from.middle_name,from.last_name,from.suffix,from.nickname,target)]:[]),
  sql('DELETE FROM cf_address_moves WHERE donor_id=?',target),
  sql('UPDATE cf_donors SET version=version+1 WHERE id=?',source),
  sql('UPDATE cf_gifts SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_consents SET donor_id=? WHERE donor_id=?',target,source),
  // A tag records the first triggering gift. If both identities already carry
  // it, retain the earlier provenance rather than whichever row SQLite visits.
  sql(`DELETE FROM cf_donor_rule_tags AS t WHERE t.donor_id=? AND EXISTS(
   SELECT 1 FROM cf_donor_rule_tags s WHERE s.donor_id=? AND s.tag=t.tag AND s.created_at<t.created_at)`,target,source),
  sql('DELETE FROM cf_donor_rule_tags WHERE donor_id=? AND tag IN (SELECT tag FROM cf_donor_rule_tags WHERE donor_id=?)',source,target),
  sql('UPDATE cf_donor_rule_tags SET donor_id=? WHERE donor_id=?',target,source),
  sql('UPDATE cf_custom_values SET donor_id=? WHERE donor_id=?',target,source),
  sql('UPDATE cf_custom_value_history SET donor_id=? WHERE donor_id=?',target,source),
  sql('DELETE FROM cf_portfolio_members WHERE donor_id=? AND EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?)',source,target),
  sql('UPDATE cf_portfolio_members SET donor_id=? WHERE donor_id=?',target,source),
  sql('DELETE FROM cf_soft_credits WHERE donor_id IN (?,?) AND gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=?)',source,target,target),
  sql('DELETE FROM cf_soft_credits WHERE donor_id=? AND gift_id IN (SELECT gift_id FROM cf_soft_credits WHERE donor_id=?)',source,target),
 ]
 statements.push(sql('DELETE FROM cf_card_expiry_notices WHERE subscription_id IN (SELECT id FROM cf_subscriptions WHERE donor_id=?)',source))
 statements.push(sql('UPDATE cf_donor_meetings SET donor_id=?,version=version+1 WHERE donor_id=?',target,source))
 for (const table of ['cf_record_documents','cf_donor_address_history','cf_research_results','cf_volunteering','cf_planned_gifts','cf_legacy_memberships','cf_recurring_task_series','cf_pledges','cf_acks','cf_events','cf_soft_credits','cf_gift_tributes','cf_giving_customers','cf_giving_intents','cf_subscriptions','cf_communications','cf_reply_tasks']) statements.push(sql(`UPDATE ${table} SET donor_id=? WHERE donor_id=?`,target,source))
 statements.push(
  sql('DELETE FROM cf_appeal_recipients WHERE donor_id=? AND appeal_id IN (SELECT appeal_id FROM cf_appeal_recipients WHERE donor_id=?)',source,target),
  sql('UPDATE cf_appeal_recipients SET donor_id=? WHERE donor_id=?',target,source),
  sql('UPDATE cf_stewardship_drafts SET donor_id=?,version=version+1,reviewed_version=NULL WHERE donor_id=?',target,source),
  sql("UPDATE cf_welcome_steps SET status='cancelled',note='Donor was merged; no further welcome emails.' WHERE donor_id IN (?,?) AND status='pending'",source,target),
  sql("UPDATE cf_welcome_enrollments SET status='completed',stopped_at=? WHERE donor_id IN (?,?) AND status='active'",c.now,source,target),
  sql('DELETE FROM cf_preference_sync WHERE donor_id IN (?,?)',source,target),
  sql('UPDATE cf_call_tasks SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_grants SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_in_kind_gifts SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_employer_matches SET employer_donor_id=? WHERE employer_donor_id=?',target,source),
  ...recognitionMergeStatements(source,target),...donorDepthMergeStatements(source,target),...majorGiftMergeStatements(source,target),
  sql('DELETE FROM cf_donor_tokens WHERE donor_id IN (?,?)',source,target),
  ...solicitationMergeCustody(c,source,target,mergeId,mergedOn),
  ...householdChanges.flatMap(({household:h,head})=>[
   ...(h.head_donor_id===source&&head===target?[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND household_id=? AND constituent_kind='person' AND constituent_status<>'deceased' AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`,'HOUSEHOLD_HEAD','The survivor is no longer eligible to carry headship.',target,h.id)]:[]),
   sql(`UPDATE cf_households SET version=version+1,head_donor_id=?,
    head_source=CASE WHEN ? IS NULL THEN NULL ELSE head_source END,
    head_imported_at=CASE WHEN ? IS NULL THEN NULL ELSE head_imported_at END,
    overrides_review=CASE WHEN addressee_override IS NOT NULL OR formal_override IS NOT NULL OR informal_override IS NOT NULL THEN 1 ELSE overrides_review END WHERE id=?`,head,head,head,h.id),
   event(c,'household.merge','household',h.id,null,{mergeId,oldHead:h.head_donor_id,newHead:head,overridesSet:[],overridesCleared:[],membershipChanged:true}),
  ]),
  ...captureMerge(tables,mergeId,'after'),
  event(c,'donor.merge','donor',source,target,{mergeId,sourceDonorId:source,targetDonorId:target,reason}),
 )
 await commit(c,statements)
 return {id:target,donorId:target,merged:source,mergeId}
}

export async function undoMerge(c:Context,p:Row):Promise<Row> {
 requireRole(c.actor,['owner','admin'],'undo donor merges')
 const mergeId = id(p.mergeId,'Merge'), merge = await one(c,'SELECT * FROM cf_donor_merge_journal WHERE id=?',mergeId)
 if (!merge || merge.status!=='active') fail('UNDO_UNAVAILABLE','This merge is already undone or its records were erased.')
 const reason = reassignmentReason('undo', p.reason)
 const tables = await journalTables(c)
 const households = await all(c,`SELECT b.row_key,b.value AS before_value,a.value AS after_value FROM cf_donor_merge_rows b JOIN cf_donor_merge_rows a USING(merge_id,table_name,row_key) WHERE b.merge_id=? AND b.table_name='cf_households' AND b.phase='before' AND a.phase='after'`,mergeId)
 await commit(c,[
  guard("EXISTS(SELECT 1 FROM cf_donor_merge_journal WHERE id=? AND status='active')",'UNDO_UNAVAILABLE','This merge can no longer be undone.',mergeId),
  guard('EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=? AND into_id=?) AND (SELECT count(*) FROM cf_donors WHERE id IN (?,?) AND erased_at IS NULL)=2','MERGE_CHANGED','The donor identities changed after this merge. Nothing was undone.',merge.source_id,merge.target_id,merge.source_id,merge.target_id),
  ...unchangedMerge(tables,mergeId),
  sql("UPDATE cf_donor_merge_journal SET status='undoing' WHERE id=?",mergeId),
  // Restoring the survivor's address is not a move: drop the rows the trigger
  // writes during the restore, so the journal's exact address history returns.
  sql("INSERT OR REPLACE INTO cf_address_moves(donor_id,effective_on,source) VALUES(?,?,'undo')",merge.target_id,c.now.slice(0,10)),
  ...restoreMerge(tables,mergeId),
  sql("DELETE FROM cf_donor_address_history WHERE donor_id IN (?,?) AND source='undo'",merge.source_id,merge.target_id),
  sql('DELETE FROM cf_address_moves WHERE donor_id=?',merge.target_id),
  ...advanceEarlierMergeVersions(tables,mergeId),
  ...households.map(h=>{const before=JSON.parse(h.before_value),after=JSON.parse(h.after_value);return event(c,'household.unmerge','household',before.id,null,{mergeId,oldHead:after.head_donor_id,newHead:before.head_donor_id,overridesSet:[],overridesCleared:[],membershipChanged:true})}),
  // Undo does not resurrect access tokens or restart cancelled email journeys.
  sql('DELETE FROM cf_donor_tokens WHERE donor_id IN (?,?)',merge.source_id,merge.target_id),
  sql('DELETE FROM cf_preference_sync WHERE donor_id IN (?,?)',merge.source_id,merge.target_id),
  sql("UPDATE cf_donor_merge_journal SET status='undone',undone_at=?,undone_by=? WHERE id=?",c.now,c.actor.name,mergeId),
  event(c,'donor.unmerge','donor',merge.source_id,merge.target_id,{mergeId,sourceDonorId:merge.source_id,targetDonorId:merge.target_id,reason}),
 ])
 return {id:merge.target_id,donorId:merge.target_id,restored:merge.source_id,mergeId,undone:true}
}
