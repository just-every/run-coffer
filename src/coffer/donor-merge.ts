import { majorGiftMergeStatements } from './major-gifts'
import { donorDepthMergeStatements } from './donor-depth'
import { commit, event, fail, guard, id, integer, one, sql, type Context, type Row, type Stmt } from './db'

export async function canonicalDonor(c: { db: D1Database }, donorId: string): Promise<string> {
 const merge = await one(c, 'SELECT into_id FROM cf_donor_merges WHERE donor_id=?', donorId)
 return merge?.into_id ?? donorId
}

/** A reviewed merge retains the source ID/email for subsequent imports. */
export async function mergeDonor(c: Context, p: Row): Promise<Row> {
 const source = id(p.sourceDonorId, 'Source donor'), target = id(p.donorId, 'Surviving donor')
 if (source === target) fail('INPUT', 'Choose two different donor records.', 400)
 const sourceVersion = integer(p.sourceVersion, 'Source version', 1), version = integer(p.version, 'Surviving version', 1)
 const statements: Stmt[] = [
  guard(`(SELECT count(*) FROM cf_donors d WHERE (id=? AND version=? OR id=? AND version=?) AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))=2`, 'VERSION', 'A donor changed or was merged. Review both records again.', source, sourceVersion, target, version),
  guard(`NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.donor_id IN (?,?) AND b.status IN ('prepared','approved'))`, 'IN_ACKNOWLEDGEMENT', 'Discard prepared or approved letters for these donors before merging.', source, target),
  guard(`NOT EXISTS(SELECT 1 FROM cf_employer_matches m JOIN cf_gifts g ON g.id=m.gift_id WHERE (m.employer_donor_id IN (?,?) AND g.donor_id IN (?,?))) AND NOT EXISTS(SELECT 1 FROM cf_employer_matches a JOIN cf_employer_matches b ON a.gift_id=b.gift_id WHERE a.employer_donor_id=? AND b.employer_donor_id=?)`, 'MATCH_CONFLICT', 'Resolve matching-gift promises between these records, or duplicate employer promises, before merging.', source,target,source,target,source,target),
  sql('INSERT INTO cf_donor_merges VALUES(?,?,?,?)', source, target, c.now, c.actor.name),
  sql('UPDATE cf_gifts SET donor_id=?,version=version+1 WHERE donor_id=?', target, source),
  sql('UPDATE cf_donor_merges SET into_id=? WHERE into_id=?', target, source),
  sql('UPDATE cf_consents SET donor_id=? WHERE donor_id=?', target, source),
  sql('DELETE FROM cf_soft_credits WHERE donor_id IN (?,?) AND gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=?)', source, target, target),
  sql('DELETE FROM cf_soft_credits WHERE donor_id=? AND gift_id IN (SELECT gift_id FROM cf_soft_credits WHERE donor_id=?)', source, target),
 ]
 for (const table of ['cf_pledges', 'cf_acks', 'cf_events', 'cf_soft_credits', 'cf_gift_tributes', 'cf_giving_customers', 'cf_giving_intents', 'cf_subscriptions'])
  statements.push(sql(`UPDATE ${table} SET donor_id=? WHERE donor_id=?`, target, source))
 statements.push(sql('UPDATE cf_call_tasks SET donor_id=?,version=version+1 WHERE donor_id=?',target,source))
 statements.push(sql('UPDATE cf_employer_matches SET employer_donor_id=? WHERE employer_donor_id=?', target, source))
 // Relationship endpoints are reconciled by the module helper below.
 statements.push(...donorDepthMergeStatements(source, target), ...majorGiftMergeStatements(source,target))
 statements.push(sql('DELETE FROM cf_donor_tokens WHERE donor_id IN (?,?)', source, target),
  sql('UPDATE cf_donors SET version=version+1 WHERE id IN (?,?)', source, target),
  event(c, 'donor.merge', 'donor', source, target, { sourceDonorId: source, targetDonorId: target }))
 await commit(c, statements)
 return { id: target, donorId: target, merged: source }
}

