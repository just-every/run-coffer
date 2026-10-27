import { all, CofferError, commit, event, fail, guard, one, sha256, sql, type Context, type Row } from '../../db'
import type { PaymentsEnv } from '../pantry'
import { QboFailure, qboRequest, type QboConnection } from './client'
import { qboConnection } from './connection'
import { prepareDeposit, verifyDocument } from './deposits'

export const qboPostings = (c: Pick<Context, 'db'>, kind: string, id: string) => all(c, `SELECT * FROM cf_qbo_postings WHERE (kind=? AND source_id=?) OR (kind='adjustment' AND source_id IN (SELECT entry_id FROM cf_payout_entries WHERE payout_id=?)) ORDER BY kind,source_id`, kind, id, kind === 'payout' ? id : '')
async function submit(c: Context, conn: QboConnection, row: Row) {
 if (row.realm_id !== conn.realm || Boolean(row.sandbox) !== conn.sandbox) fail('QBO_COMPANY', 'Reconnect the QuickBooks company that owns this submission.', 409)
 if (row.state === 'posted') return row
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_qbo_connection WHERE id=1 AND realm_id=? AND sandbox=?)', 'QBO_CONNECTION_CHANGED', 'The QuickBooks company changed.', conn.realm, conn.sandbox ? 1 : 0), sql("UPDATE cf_qbo_postings SET state='sending',attempts=attempts+1,error=NULL WHERE kind=? AND source_id=? AND state<>'posted'", row.kind, row.source_id), event(c, 'quickbooks.attempt', 'accounting', row.source_id, null, { kind: row.kind, requestId: row.request_id })])
 try {
  // The same durable request ID and bytes are used even after a lost response,
  // concurrent action, restart or archive restore. Intuit returns the first result.
  const result = verifyDocument(row.entity, JSON.parse(row.payload), await qboRequest(conn, row.entity.toLowerCase() + '?requestid=' + encodeURIComponent(row.request_id), JSON.parse(row.payload)))
  await commit(c, [sql("UPDATE cf_qbo_postings SET state='posted',external_id=?,posted_at=?,error=NULL WHERE kind=? AND source_id=?", String(result.Id), c.now, row.kind, row.source_id), event(c, 'quickbooks.posted', 'accounting', row.source_id, null, { kind: row.kind, externalId: String(result.Id), requestId: row.request_id })])
 } catch (error) {
  if (error instanceof CofferError && error.code === 'SESSION_CHANGED') throw error
  const definitive = error instanceof QboFailure && error.definitive
  await commit(c, [sql("UPDATE cf_qbo_postings SET state=?,error=? WHERE kind=? AND source_id=? AND state<>'posted'", definitive ? 'failed' : 'uncertain', error instanceof QboFailure ? error.message : 'QuickBooks did not confirm matching lines and totals. Retry the saved request to recover it.', row.kind, row.source_id)])
 }
 return (await one(c, 'SELECT * FROM cf_qbo_postings WHERE kind=? AND source_id=?', row.kind, row.source_id))!
}
export async function postDeposit(c: Context, env: PaymentsEnv, kind: string, id: string, confirm: unknown) {
 if (confirm !== 'yes') fail('confirmation_required', 'Confirm this deposit and its separate adjustment entries before posting.', 400)
 const conn = await qboConnection(c, env)
 let rows = await qboPostings(c, kind, id)
 if (!rows.some(r => r.kind === kind && r.source_id === id)) {
  const bundle = await prepareDeposit(c, conn, kind, id)
  const statements = [...bundle.guards]
  for (const doc of bundle.documents) {
   const requestId = 'cf-' + (await sha256(`${env.AUTH_ORIGIN}:${conn.realm}:${conn.sandbox}:${doc.kind}:${doc.sourceId}`)).slice(0, 40)
   statements.push(sql(`INSERT OR IGNORE INTO cf_qbo_postings(kind,source_id,realm_id,sandbox,entity,request_id,payload,state,created_at) VALUES(?,?,?,?,?,?,?,'ready',?)`, doc.kind, doc.sourceId, conn.realm, conn.sandbox ? 1 : 0, doc.entity, requestId, JSON.stringify(doc.payload), c.now))
  }
  statements.push(event(c, 'quickbooks.authorized', 'accounting', id, null, { kind, amountCents: bundle.amountCents, documents: bundle.documents.map(d => ({ kind: d.kind, sourceId: d.sourceId })) }))
  await commit(c, statements)
  rows = await qboPostings(c, kind, id)
 }
 // Keep each refund and dispute as its own entry before filing the bank deposit.
 for (const row of rows.sort((a, b) => (a.kind === 'adjustment' ? 0 : 1) - (b.kind === 'adjustment' ? 0 : 1))) {
  const result = await submit(c, conn, row)
  if (result.state !== 'posted') break
 }
 return { postings: await qboPostings(c, kind, id) }
}
export async function readRemote(c: Context, env: PaymentsEnv, kind: string, id: string) {
 const conn = await qboConnection(c, env), rows = await qboPostings(c, kind, id), documents = []
 for (const row of rows) {
  if (row.realm_id !== conn.realm || Boolean(row.sandbox) !== conn.sandbox) fail('QBO_COMPANY', 'Reconnect the QuickBooks company that owns these entries.', 409)
  if (row.state !== 'posted') continue
  const result = await qboRequest(conn, row.entity.toLowerCase() + '/' + encodeURIComponent(row.external_id))
  const remote = verifyDocument(row.entity, JSON.parse(row.payload), result)
  if (String(remote.Id) !== row.external_id) fail('QBO_RESPONSE', 'QuickBooks returned another accounting entry.', 502)
  documents.push({ kind: row.kind, sourceId: row.source_id, entity: row.entity, record: remote })
 }
 return { documents }
}
