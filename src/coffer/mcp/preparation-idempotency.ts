import { requireGrant } from '../agent-grants'
import { commit, event, fail, guard, one, sha256, sql, type Context, type Row, type Stmt, type TransactionPlan } from '../db'

type Preparation = 'ack.prepare' | 'appeal.prepare'
type Receipt = { request_hash: string; grant_id: string; result_id: string; outcome: string; donor_ids: string; unavailable: number }
const canonical = (value: any): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)

/** Receipts retain only native identifiers and the original aggregate outcome.
 * No key, canonical input, frozen donor prose or credential is stored here.
 * There is no expiry cleanup: successful receipts survive at least 24 hours. */
export async function prepareIdempotently(c: Context, request: Request, tool: Preparation, args: Row, prepare: (staged: Context) => Promise<Row>): Promise<Row> {
 const key = request.headers.get('idempotency-key') ?? ''
 if (!/^[\x21-\x7e]{1,200}$/.test(key)) fail('INPUT', 'Idempotency-Key must contain 1–200 visible ASCII characters.', 400)
 const keyHash = await sha256(key), requestHash = await sha256(tool + '\n' + canonical(args))
 const identity = c.actor.grant ?? c.actor.preparationGrant
 if (!identity) fail('GRANT_REQUIRED', 'A current preparation grant is required.', 403)
 // A version change must not create a new namespace and repeat an old effect.
 const grantId = identity.id
 if (c.actor.grant) await requireGrant(c, tool)
 const read = () => one<Receipt>(c, 'SELECT request_hash,grant_id,result_id,outcome,donor_ids,unavailable FROM cf_mcp_preparations WHERE principal=? AND key_hash=?', c.actor.id, keyHash)
 const replay = async (receipt: Receipt) => {
  if (receipt.request_hash !== requestHash) fail('idempotency_conflict', 'This Idempotency-Key was used for different preparation arguments.')
  if (receipt.grant_id !== grantId) fail('GRANT_SCOPE', 'This preparation belongs to a different grant.', 403)
  if (receipt.unavailable) fail('PREPARATION_UNAVAILABLE', 'A prepared record was erased. The saved outcome cannot be replayed.')
  const outcome = JSON.parse(receipt.outcome)
  const checks: Stmt[] = [guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=j.value AND d.erased_at IS NULL) OR EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=j.value))`, 'PREPARATION_UNAVAILABLE', 'A prepared record was erased or merged. The saved outcome cannot be replayed.', receipt.donor_ids)]
  if (tool === 'ack.prepare') {
   checks.push(guard(`EXISTS(SELECT 1 FROM cf_ack_batches WHERE id=? AND prepared_by_id=? AND content_hash=? AND letters=?) AND (SELECT count(*) FROM cf_acks WHERE batch_id=?)=? AND NOT EXISTS(SELECT 1 FROM cf_acks WHERE batch_id=? AND (void_reason IS NOT NULL OR donor_id NOT IN(SELECT value FROM json_each(?))))`, 'PREPARATION_UNAVAILABLE', 'The saved receipt batch is no longer in its original custody.', receipt.result_id, c.actor.id, outcome.contentHash, outcome.letters, receipt.result_id, outcome.letters, receipt.result_id, receipt.donor_ids))
   if (c.actor.grant) {
    const grant = await requireGrant(c, tool)
    // The named preparation door never traverses relationships or households.
    checks.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j JOIN cf_donors d ON d.id=j.value WHERE d.id NOT IN(SELECT value FROM json_each(?)) OR d.household_id IS NOT NULL OR d.constituent_kind<>'person' OR d.constituent_status<>'active' OR EXISTS(SELECT 1 FROM cf_soft_credits sc WHERE sc.donor_id=d.id) OR EXISTS(SELECT 1 FROM cf_relationships r WHERE r.donor_id=d.id OR r.related_donor_id=d.id))`, 'GRANT_SCOPE', 'Receipt records moved outside the current grant.', receipt.donor_ids, grant.donor_ids))
   }
  } else checks.push(guard(`EXISTS(SELECT 1 FROM cf_appeals WHERE id=? AND prepared_by_id=? AND content_hash=? AND recipients=?) AND (SELECT count(*) FROM cf_appeal_recipients WHERE appeal_id=?)=? AND NOT EXISTS(SELECT 1 FROM cf_appeal_recipients WHERE appeal_id=? AND donor_id NOT IN(SELECT value FROM json_each(?)))`, 'PREPARATION_UNAVAILABLE', 'The saved appeal is no longer in its original custody.', receipt.result_id, c.actor.id, outcome.contentHash, outcome.recipients, receipt.result_id, outcome.recipients, receipt.result_id, receipt.donor_ids))
  // Current authority and custody are checked together before disclosing even
  // the old aggregate. Replay never reserves quota or restores approval state.
  await commit(c, [...checks, event(c, 'mcp.preparationReplay', 'preparation', receipt.result_id, null, { tool }, 'cf_access_events')])
  return outcome
 }
 const saved = await read()
 if (saved) return replay(saved)
 const transactionPlan: TransactionPlan = { statements: [], commits: 0 }
 try {
  const outcome = await prepare({ ...c, transactionPlan })
  // These two allowlisted tools are local-only. A legacy quota reservation and
  // the native freeze may each stage one commit, published in one D1 batch.
  if (!outcome.id || transactionPlan.commits < 1 || transactionPlan.commits > 2) fail('ATOMIC_WRITE_REQUIRED', 'Preparation must publish as one local transaction.')
  const table = tool === 'ack.prepare' ? 'cf_acks' : 'cf_appeal_recipients', column = tool === 'ack.prepare' ? 'batch_id' : 'appeal_id'
  await commit(c, [guard('NOT EXISTS(SELECT 1 FROM cf_mcp_preparations WHERE principal=? AND key_hash=?)', 'IDEMPOTENCY_RACE', 'Another request is publishing this preparation.', c.actor.id, keyHash), ...transactionPlan.statements,
   sql(`INSERT INTO cf_mcp_preparations(principal,key_hash,request_hash,grant_id,tool,result_id,outcome,donor_ids,created_at) SELECT ?,?,?,?,?,?,?,json_group_array(DISTINCT donor_id),? FROM ${table} WHERE ${column}=?`, c.actor.id, keyHash, requestHash, grantId, tool, outcome.id, JSON.stringify(outcome), c.now, outcome.id)])
  return outcome
 } catch (cause) {
  // A competitor can finish before native validation or the quota read, as
  // well as during the final batch. Its receipt wins in every such case.
  const concurrent = await read()
  if (concurrent) return replay(concurrent)
  throw cause
 }
}
