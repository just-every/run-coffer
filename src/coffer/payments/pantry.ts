import { CofferError, commit, fail, guard, one, sha256, sql, text, type Context, type Stmt } from '../db'
import { managed, type GivingEnv } from '../giving/stripe'
import { evidenceCsv, payoutJournal, type JournalLine } from './exports'
import { connection, context, request, type Proposal } from './pantry-client'

export interface PaymentsEnv extends GivingEnv {
 PANTRY_ORIGIN?: string
 PANTRY_AGENT_TOKEN?: string
 PANTRY_DEPOSIT_ACCOUNT?: string
 PANTRY_FEE_ACCOUNT?: string
 PANTRY_FUND_ACCOUNTS?: string
 PANTRY_FUND_CLASSES?: string
 PANTRY_FUND_LOCATIONS?: string
 QBO_ACCOUNT_NAMES?: string
}
type Posting = {
 source_id: string; state: string; external_id: string | null; destination: string; posted_at: string | null
 proposal_id: string | null; payload_hash: string; summary: string; created_at: string
}
type DepositKind = 'payout' | 'batch'
export type PantryDeposit = { id: string; kind: DepositKind; prepare: () => {csv:string;journal:{date:string;lines:JournalLine[]};guards:Stmt[]} }
const store = (kind: DepositKind) => kind === 'batch' ? {table:'cf_batch_postings',key:'batch_id'} : {table:'cf_payout_postings',key:'payout_id'}
const saved = (c: Context, id: string, kind: DepositKind) => {const {table,key}=store(kind);return one<Posting>(c, `SELECT *,${key} AS source_id FROM ${table} WHERE ${key} = ?`, id)}

async function record(c: Context, row: Posting, state: string, proposalId: string | null = row.proposal_id, journalId: string | null = null, kind: DepositKind = 'payout') {
 const {table,key}=store(kind)
 await commit(c, [sql(`UPDATE ${table} SET state = ?, proposal_id = ?, external_id = ?, posted_at = ? WHERE ${key} = ? AND state <> 'posted' AND payload_hash = ? AND summary = ?`,
  state, proposalId, journalId, state === 'posted' ? c.now : null, row.source_id, row.payload_hash, row.summary)])
 return (await saved(c, row.source_id, kind))!
}

async function outcome(c: Context, row: Posting, p: Proposal, kind: DepositKind) {
 if (!p || typeof p.id !== 'string' || !p.id || p.kind !== 'journal' || p.summary !== row.summary || !p.payload || await sha256(JSON.stringify(p.payload)) !== row.payload_hash) fail('PANTRY_RESPONSE', 'The Pantry proposal differs from this saved submission. Review it in Pantry.', 409)
 if (p.status === 'approved') {
  if (p.result_kind !== 'journal' || typeof p.result_id !== 'string' || !p.result_id) fail('PANTRY_RESPONSE', 'Pantry approval has no posted journal ID. Review it in Pantry.', 502)
  return record(c, row, 'posted', p.id, p.result_id, kind)
 }
 if (!['proposed', 'rejected', 'stale'].includes(p.status)) fail('PANTRY_RESPONSE', 'Pantry returned an unknown proposal state.', 502)
 return record(c, row, p.status, p.id, null, kind)
}

async function refresh(c: Context, conn: ReturnType<typeof connection>, row: Posting, kind: DepositKind) {
 if (row.destination !== conn.origin) fail('PANTRY_INSTALLATION', 'Reconnect the Pantry installation that received this payout.', 409)
 if (!['sending', 'uncertain', 'proposed'].includes(row.state)) return row
 if (row.proposal_id) return outcome(c, row, await request<Proposal>(conn, `/api/pantry/agent/proposals/${encodeURIComponent(row.proposal_id)}`), kind)
 const matches = (await context(conn)).proposals.filter(p => p.summary === row.summary)
 if (matches.length > 1) fail('PANTRY_DUPLICATE', 'Multiple Pantry proposals share this payout marker. Reconcile them in Pantry.', 409)
 // Context is bounded: absence is never evidence that an interrupted send failed.
 if (!matches.length) return record(c, row, 'uncertain', null, null, kind)
 return outcome(c, row, matches[0], kind)
}

/** File one evidence-backed deposit; a person approves inside Pantry. */
export async function submitDeposit(c: Context, env: PaymentsEnv, deposit: PantryDeposit, documentId?: string) {
 if (managed(env)) fail('not_available', 'Pantry is not available yet on RER Managed.', 503)
 const {kind}=deposit, id=text(deposit.id,'Deposit ID',200), {table,key}=store(kind), previous=await saved(c,id,kind)
 if(previous?.state==='posted')return previous
 const conn=connection(env)
 if(previous)return refresh(c,conn,previous,kind)
 const {csv,journal,guards}=deposit.prepare(),evidenceHash=await sha256(csv),remote=await context(conn)
 const docId = text(documentId, 'Uploaded Pantry document ID', 200), doc = remote.documents.find(d => d.id === docId)
 if (!doc || !(doc.sha256?.toLowerCase() === evidenceHash || doc.text === csv)) fail('PANTRY_EVIDENCE', 'Upload the exact payout evidence CSV in Pantry Documents, then enter its document ID.', 409)
 const accountIds = [...new Set(journal.lines.map(l => l.accountId))]
 const refs = accountIds.map(accountId => {
  const a = remote.accounts.find(a => a.id === accountId)
  if (!a || !a.active || ['receivable', 'payable'].includes(a.subtype) || !a.revision) fail('PANTRY_MAPPING', 'Choose active Pantry accounts outside receivable and payable control accounts.', 409)
  if(journal.lines.some(l=>l.accountId===accountId&&(l.role==='deposit'?(a.type!=='asset'||a.subtype!=='bank'):a.type!==(l.role==='fee'?'expense':'income'))))fail('PANTRY_MAPPING','Map deposits to a bank asset, fees to an expense and funds to income accounts.',409)
  return { kind: 'account', id: a.id, revision: a.revision }
 })
 const installation = (await sha256(String(env.AUTH_ORIGIN))).slice(0, 16)
 const summary = `coffer:${installation}:${kind === 'batch' ? 'batch:' : ''}${id}:${evidenceHash}`
 if (summary.length > 300) fail('PANTRY_PAYLOAD', 'The payout reference exceeds Pantry’s summary limit.', 400)
 const payload = { date: journal.date, memo: `Coffer ${kind === 'batch' ? 'check or cash batch' : 'Stripe payout'} ${id}`.slice(0, 500), documentId: docId,
  passages: csv.split('\r\n').filter(Boolean).flatMap(line => line.match(/[\s\S]{1,2000}/g) ?? []),
  lines: journal.lines.map(({ accountId, debit, credit, memo, className, locationName }) => ({ accountId, debit, credit, memo, ...(className?{className}:{}), ...(locationName?{locationName}:{}) })) }
 if (JSON.stringify(payload).length > 100_000) fail('PANTRY_PAYLOAD', 'This payout exceeds Pantry’s proposal size limit. Prepare its journal in Pantry.', 400)
 const hash = await sha256(JSON.stringify(payload)), known = remote.proposals.filter(p => p.summary === summary)
 if (known.length > 1 || known.length === 1 && await sha256(JSON.stringify(known[0].payload)) !== hash) fail('PANTRY_DUPLICATE', 'Pantry contains a different proposal for this payout. Reconcile it in Pantry.', 409)
 try {
  await commit(c, [guard(`NOT EXISTS (SELECT 1 FROM ${table} WHERE ${key} = ?)`, 'PAYOUT_CLAIMED', 'This deposit already has a submission. Refresh its status.', id),
   ...guards,
   sql(`INSERT INTO ${table}(${key},state,external_id,destination,posted_at,proposal_id,payload_hash,summary,created_at) VALUES(?,'sending',NULL,?,NULL,NULL,?,?,?)`, id, conn.origin, hash, summary, c.now)])
 } catch (error) {
  if (!(error instanceof CofferError) || error.code !== 'PAYOUT_CLAIMED') throw error
  return (await saved(c, id, kind))!
 }
 const claimed = (await saved(c, id, kind))!
 try {
  const proposal = known[0] ?? await request<Proposal>(conn, '/api/pantry/agent/proposals', { kind: 'journal', summary, payload, refs })
  return await outcome(c, claimed, proposal, kind)
 } catch (error) {
  if (error instanceof CofferError && error.code === 'SESSION_CHANGED') throw error
  // Even a malformed success can follow acceptance. Do not send the payout twice.
  return record(c, claimed, 'uncertain', null, null, kind)
 }
}

/** Verify the exact saved proposal without resubmitting or creating money.
 * Posted rows are checked too: approval and its immutable journal ID must agree. */
export async function reconciliationPosting(c: Context, env: PaymentsEnv, payoutId: string, kind: DepositKind = 'payout') {
 if (managed(env)) fail('not_available', 'Pantry is not available yet on RER Managed.', 503)
 const row = await saved(c, payoutId, kind)
 if (!row) return null
 const conn = connection(env)
 if (row.destination !== conn.origin) fail('PANTRY_INSTALLATION', 'Reconnect the Pantry installation that received this payout.', 409)
 if (!row.proposal_id) {
  if (row.state === 'posted') fail('PANTRY_RESPONSE', 'This posted payout has no verifiable Pantry proposal ID.', 409)
  return refresh(c, conn, row, kind)
 }
 const proposal = await request<Proposal>(conn, `/api/pantry/agent/proposals/${encodeURIComponent(row.proposal_id)}`)
 if (proposal.id !== row.proposal_id) fail('PANTRY_RESPONSE', 'Pantry returned a different proposal ID.', 409)
 if (row.state === 'posted' && (proposal.status !== 'approved' || proposal.result_kind !== 'journal' || proposal.result_id !== row.external_id)) fail('PANTRY_RESPONSE', 'The saved Pantry journal no longer matches its approval.', 409)
 return outcome(c, row, proposal, kind)
}

export async function postToPantry(c: Context, env: PaymentsEnv, view: any, documentId?: string) {
 const id=view.payout.id
 return submitDeposit(c,env,{id,kind:'payout',prepare:()=>({csv:evidenceCsv(view),journal:payoutJournal(view,env),guards:[
  guard("EXISTS(SELECT 1 FROM cf_payouts WHERE id=? AND status='paid' AND complete=1 AND amount_cents=?) AND (SELECT COUNT(*) FROM cf_payout_entries WHERE payout_id=?)=? AND NOT EXISTS(SELECT 1 FROM cf_payout_entries WHERE payout_id=? AND entry_id NOT IN (SELECT value FROM json_each(?)))", 'PAYOUT_CHANGED', 'The payout changed. Download fresh evidence before posting.', id, view.payout.amount_cents, id, view.lines.length, id, JSON.stringify(view.lines.map((line: any) => line.id)))
 ]})},documentId)
}
