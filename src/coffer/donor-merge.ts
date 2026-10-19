import { reassignmentReason } from './reassignment-reasons'
import { requireRole } from './auth'
import { majorGiftMergeStatements } from './major-gifts'
import { donorDepthMergeStatements } from './donor-depth'
import { MERGE_FIELDS } from './duplicates'
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
 const reason = reassignmentReason('merge', p.reason)
 const mergeId = newId(), tables = await journalTables(c)
 const statements: Stmt[] = [
  guard(`(SELECT count(*) FROM cf_donors d WHERE (id=? AND version=? OR id=? AND version=?) AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))=2`, 'VERSION', 'A donor changed or was merged. Review both records again.', source,sourceVersion,target,version),
  ...quietCommunications(source,target),
  guard(`NOT EXISTS(SELECT 1 FROM cf_employer_matches m JOIN cf_gifts g ON g.id=m.gift_id WHERE (m.employer_donor_id IN (?,?) AND g.donor_id IN (?,?))) AND NOT EXISTS(SELECT 1 FROM cf_employer_matches a JOIN cf_employer_matches b ON a.gift_id=b.gift_id WHERE a.employer_donor_id=? AND b.employer_donor_id=?)`, 'MATCH_CONFLICT', 'Resolve matching-gift promises between these records, or duplicate employer promises, before merging.', source,target,source,target,source,target),
  sql("INSERT INTO cf_donor_merge_journal(id,source_id,target_id,merged_at,merged_by,status) VALUES(?,?,?,?,?,'active')",mergeId,source,target,c.now,c.actor.name),
  ...captureMerge(tables,mergeId,'before'),
  sql('INSERT INTO cf_donor_merges VALUES(?,?,?,?)', source,target,c.now,c.actor.name),
  sql('UPDATE cf_donor_merges SET into_id=? WHERE into_id=?',target,source),
  sql('INSERT OR IGNORE INTO cf_donor_aliases(donor_id,email) SELECT id,email FROM cf_donors WHERE id IN (?,?) AND email IS NOT NULL',source,target),
  sql(`UPDATE cf_donors SET ${MERGE_FIELDS.map(([,,column])=>`${column}=?`).join(',')},version=version+1 WHERE id=?`,...selected,target),
  sql('UPDATE cf_donors SET version=version+1 WHERE id=?',source),
  sql('UPDATE cf_gifts SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_consents SET donor_id=? WHERE donor_id=?',target,source),
  sql('DELETE FROM cf_portfolio_members WHERE donor_id=? AND EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?)',source,target),
  sql('UPDATE cf_portfolio_members SET donor_id=? WHERE donor_id=?',target,source),
  sql('DELETE FROM cf_soft_credits WHERE donor_id IN (?,?) AND gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=?)',source,target,target),
  sql('DELETE FROM cf_soft_credits WHERE donor_id=? AND gift_id IN (SELECT gift_id FROM cf_soft_credits WHERE donor_id=?)',source,target),
 ]
 for (const table of ['cf_planned_gifts','cf_legacy_memberships','cf_recurring_task_series','cf_pledges','cf_acks','cf_events','cf_soft_credits','cf_gift_tributes','cf_giving_customers','cf_giving_intents','cf_subscriptions','cf_communications','cf_reply_tasks']) statements.push(sql(`UPDATE ${table} SET donor_id=? WHERE donor_id=?`,target,source))
 statements.push(
  sql('DELETE FROM cf_appeal_recipients WHERE donor_id=? AND appeal_id IN (SELECT appeal_id FROM cf_appeal_recipients WHERE donor_id=?)',source,target),
  sql('UPDATE cf_appeal_recipients SET donor_id=? WHERE donor_id=?',target,source),
  sql('UPDATE cf_stewardship_drafts SET donor_id=?,version=version+1,reviewed_version=NULL WHERE donor_id=?',target,source),
  sql("UPDATE cf_welcome_steps SET status='cancelled',note='Donor was merged; no further welcome emails.' WHERE donor_id IN (?,?) AND status='pending'",source,target),
  sql("UPDATE cf_welcome_enrollments SET status='completed',stopped_at=? WHERE donor_id IN (?,?) AND status='active'",c.now,source,target),
  sql('DELETE FROM cf_preference_sync WHERE donor_id IN (?,?)',source,target),
  sql('UPDATE cf_call_tasks SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_grants SET donor_id=?,version=version+1 WHERE donor_id=?',target,source),
  sql('UPDATE cf_employer_matches SET employer_donor_id=? WHERE employer_donor_id=?',target,source),
  ...donorDepthMergeStatements(source,target),...majorGiftMergeStatements(source,target),
  sql('DELETE FROM cf_donor_tokens WHERE donor_id IN (?,?)',source,target),
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
 await commit(c,[
  guard("EXISTS(SELECT 1 FROM cf_donor_merge_journal WHERE id=? AND status='active')",'UNDO_UNAVAILABLE','This merge can no longer be undone.',mergeId),
  guard('EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=? AND into_id=?) AND (SELECT count(*) FROM cf_donors WHERE id IN (?,?) AND erased_at IS NULL)=2','MERGE_CHANGED','The donor identities changed after this merge. Nothing was undone.',merge.source_id,merge.target_id,merge.source_id,merge.target_id),
  ...unchangedMerge(tables,mergeId),
  sql("UPDATE cf_donor_merge_journal SET status='undoing' WHERE id=?",mergeId),
  ...restoreMerge(tables,mergeId),
  ...advanceEarlierMergeVersions(tables,mergeId),
  // Undo does not resurrect access tokens or restart cancelled email journeys.
  sql('DELETE FROM cf_donor_tokens WHERE donor_id IN (?,?)',merge.source_id,merge.target_id),
  sql('DELETE FROM cf_preference_sync WHERE donor_id IN (?,?)',merge.source_id,merge.target_id),
  sql("UPDATE cf_donor_merge_journal SET status='undone',undone_at=?,undone_by=? WHERE id=?",c.now,c.actor.name,mergeId),
  event(c,'donor.unmerge','donor',merge.source_id,merge.target_id,{mergeId,sourceDonorId:merge.source_id,targetDonorId:merge.target_id,reason}),
 ])
 return {id:merge.target_id,donorId:merge.target_id,restored:merge.source_id,mergeId,undone:true}
}
