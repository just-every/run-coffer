import { all, CofferError, commit, one, type Context, type Row, type Stmt } from '../db'
import type { PaymentsEnv } from '../payments/pantry'
import { QboFailure } from '../payments/quickbooks/client'
import { qboConnection, qboOwner, qboReadGuard } from '../payments/quickbooks/connection'
import { compareDocument, prepareDeposit } from '../payments/quickbooks/deposits'
import { qboPostings, readPosting } from '../payments/quickbooks/postings'
import type { Finding } from './reconcile-scan'

export const quickbooksKinds = ['quickbooks_missing', 'quickbooks_changed', 'quickbooks_failed', 'quickbooks_uncertain', 'quickbooks_incomplete']
export type QuickbooksObservation = { sourceId: string; complete: boolean; findings: Finding[] }
const detail = 'Review the cited source and saved request in Payments and QuickBooks. Corrections require the existing explicit accounting approval; this check submits no deposit or journal and never retries an uncertain posting.'
const finding = (sourceId: string, kind: string, summary: string, why: string, evidence: Row): Finding => ({ sourceId, kind, summary, why, evidence, proposed: { action: 'review', detail } })

function explain(expected: Row, remote: Row, differences: string[]) {
 const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
 const names: Row = { bank: 'Bank account', source: 'Source reference', date: 'Date', currency: 'Currency', location: 'Location', totalCents: 'Deposit total' }
 const lines = (left: Row[], right: Row[]) => {
  const remaining = right.map(line => JSON.stringify(line))
  return left.filter(line => { const index = remaining.indexOf(JSON.stringify(line)); if (index < 0) return true; remaining.splice(index, 1); return false })
 }
 const describe = (line: Row) => `${money(line.cents)} in account ${line.account}${line.fundClass ? ', fund class ' + line.fundClass : ''}${line.location ? ', location ' + line.location : ''}${line.posting ? ', ' + line.posting.toLowerCase() : ''}`
 return differences.flatMap(key => key === 'lines' ? [
  ...lines(expected.lines, remote.lines).map(line => 'Missing expected accounting line: ' + describe(line) + '.'),
  ...lines(remote.lines, expected.lines).map(line => 'Unexpected remote accounting line: ' + describe(line) + '.'),
 ] : [`${names[key] ?? key}: expected ${key === 'totalCents' ? money(expected[key]) : expected[key] ?? 'none'}; read ${key === 'totalCents' ? money(remote[key]) : remote[key] ?? 'none'}.`])
}

/** Explicit owner action only. Existing background reconciliation gains no token access. */
export async function scanQuickbooks(c: Context, env: PaymentsEnv) {
 qboOwner(c, env)
 const observations: QuickbooksObservation[] = [], errors: string[] = [], guards: Stmt[] = []
 let checkedSources = 0, checkedDocuments = 0
 const configured = await one(c, 'SELECT 1 FROM cf_qbo_connection WHERE id=1')
 if (!configured) return { observations, guards, checkedSources, checkedDocuments, errors: ['QuickBooks is not connected. Earlier exceptions remain open.'], complete: false }
 let conn
 try { conn = await qboConnection(c, env) } catch (error) {
  if (error instanceof CofferError && ['SESSION_CHANGED', 'QBO_CONNECTION_CHANGED'].includes(error.code)) throw error
  return { observations, guards, checkedSources, checkedDocuments, errors: ['QuickBooks authorization is unavailable. Earlier exceptions remain open.'], complete: false }
 }
 guards.push(qboReadGuard(conn))
 const sources = await all(c, "SELECT 'payout' AS kind,id FROM cf_payouts UNION ALL SELECT 'batch' AS kind,id FROM cf_gift_batches WHERE status='closed' ORDER BY kind,id")
 for (const source of sources) {
  const rows = await qboPostings(c, source.kind, source.id)
  const sourceUrl = source.kind === 'payout' ? '/api/coffer/payments/' + encodeURIComponent(source.id) : '/api/coffer/gift-batches?id=' + encodeURIComponent(source.id)
  const citation = { kind: source.kind, id: source.id, url: sourceUrl, reviewUrl: `/app/payouts/quickbooks/${source.kind}/${encodeURIComponent(source.id)}`, pageUrl: source.kind === 'payout' ? '/app/payouts/' + encodeURIComponent(source.id) : '/app/payouts/batches/' + encodeURIComponent(source.id) }
  const sourceKey = `quickbooks:source:${source.kind}:${source.id}`
  let documents, sourceComplete = true
  try {
   // Existing claims retain their original mapping and exact approved bytes.
   // Preparing the native bundle also identifies any absent adjustment claim.
   documents = (await prepareDeposit(c, conn, source.kind, source.id)).documents
   observations.push({ sourceId: sourceKey, complete: true, findings: [] })
  } catch (error) {
   if (error instanceof CofferError && ['SESSION_CHANGED', 'QBO_CONNECTION_CHANGED'].includes(error.code)) throw error
   sourceComplete = false
   const sourceId = sourceKey
   observations.push({ sourceId, complete: false, findings: [finding(sourceId, 'quickbooks_incomplete', 'QuickBooks source comparison is incomplete.', 'The native source or current mapping cannot form a complete deposit. Earlier exceptions remain open.', { source: citation, reason: error instanceof CofferError ? error.code : 'SOURCE_UNAVAILABLE' })] })
   // Frozen requests can still be checked when a current mapping is unavailable.
   documents = rows.map(row => ({ kind: row.kind, sourceId: row.source_id, entity: row.entity, payload: JSON.parse(row.payload) }))
  }
  for (const document of documents) {
   const sourceId = `quickbooks:${document.kind}:${document.sourceId}`
   const row = rows.find(r => r.kind === document.kind && r.source_id === document.sourceId)
   const evidence: Row = { expected: compareDocument(document.entity, row ? JSON.parse(row.payload) : document.payload, {}).expected, source: citation, document: { kind: document.kind, sourceId: document.sourceId, entity: document.entity }, ...(row ? { posting: { requestId: row.request_id, state: row.state, externalId: row.external_id, companyId: row.realm_id } } : {}) }
   let issue: Finding | null = null, complete = false
   if (!row) issue = finding(sourceId, 'quickbooks_missing', 'QuickBooks accounting submission is absent.', 'This native deposit or adjustment has no saved QuickBooks request; a source record is not proof of a posted accounting entry.', evidence)
   else if (row.state !== 'posted') {
    const failed = row.state === 'failed', uncertain = ['uncertain', 'sending'].includes(row.state)
    issue = finding(sourceId, failed ? 'quickbooks_failed' : uncertain ? 'quickbooks_uncertain' : 'quickbooks_missing', failed ? 'QuickBooks posting failed.' : uncertain ? 'QuickBooks posting is uncertain.' : 'QuickBooks posting is not confirmed.', `The saved request is ${row.state}. Only the explicit Payments recovery door can act on it; the agent cannot confirm or resubmit it.`, evidence)
   } else {
    try {
     const remote = await readPosting(c, conn, row)
     const comparison = compareDocument(row.entity, JSON.parse(row.payload), remote)
     evidence.expected = comparison.expected; evidence.remote = comparison.remote; evidence.differences = comparison.differences
     complete = comparison.complete
     if (!complete) issue = finding(sourceId, 'quickbooks_incomplete', 'QuickBooks document read is incomplete.', 'The independent read did not include a complete accounting document. Earlier exceptions remain open.', evidence)
     else if (String(remote[row.entity].Id) !== row.external_id || comparison.differences.length) {
      evidence.explanation = explain(comparison.expected, comparison.remote!, comparison.differences)
      if (String(remote[row.entity].Id) !== row.external_id) { evidence.differences.push('record ID'); evidence.explanation.push(`Record ID: expected ${row.external_id}; read ${remote[row.entity].Id}.`) }
      issue = finding(sourceId, 'quickbooks_changed', 'QuickBooks accounting facts differ.', `The independent ${row.entity} read differs in ${evidence.differences.join(', ')}. The saved request and original source remain unchanged.`, evidence)
     }
    } catch (error) {
     if (error instanceof CofferError && ['SESSION_CHANGED', 'QBO_CONNECTION_CHANGED'].includes(error.code)) throw error
     const absent = error instanceof QboFailure && error.definitive && (error.code === '610' || error.status === 404)
     issue = finding(sourceId, absent ? 'quickbooks_missing' : 'quickbooks_incomplete', absent ? 'QuickBooks accounting entry is absent.' : 'QuickBooks document read is unavailable.', absent ? 'QuickBooks reports that the cited accounting entry does not exist. Review the original request without inventing another deposit.' : 'The independent read could not be completed. Earlier exceptions remain open.', evidence)
    }
   }
   observations.push({ sourceId, complete: complete && sourceComplete, findings: issue ? [issue] : [] })
   checkedDocuments++
  }
  checkedSources++
 }
 // A disconnect or revoked session during a read cannot publish a clean result.
 await commit(c, guards)
 if (observations.some(o => !o.complete)) errors.push('QuickBooks comparison is incomplete; unverified and earlier exceptions remain open.')
 return { observations, guards, checkedSources, checkedDocuments, errors, complete: !errors.length }
}
