import { CofferError, commit, fail, guard, one, sha256, sql, text, type Context } from '../db'
import { managed, type GivingEnv } from '../giving/stripe'
import { evidenceCsv, payoutJournal } from './exports'

export interface PaymentsEnv extends GivingEnv {
 PANTRY_ORIGIN?: string
 PANTRY_AGENT_TOKEN?: string
 PANTRY_DEPOSIT_ACCOUNT?: string
 PANTRY_FEE_ACCOUNT?: string
 PANTRY_FUND_ACCOUNTS?: string
 QBO_ACCOUNT_NAMES?: string
}
type Posting = {
 payout_id: string; state: string; external_id: string | null; destination: string; posted_at: string | null
 proposal_id: string | null; payload_hash: string; summary: string; created_at: string
}
type Proposal = {
 id: string; kind: string; summary: string; payload: Record<string, unknown>; status: string
 result_kind?: string | null; result_id?: string | null
}
type Account = { id: string; type: string; subtype: string; active: number; revision: string }
type RemoteContext = { accounts: Account[]; documents: { id: string; sha256?: string; text?: string }[]; proposals: Proposal[] }

function connection(env: PaymentsEnv) {
 let url: URL
 try { url = new URL(env.PANTRY_ORIGIN ?? '') } catch { fail('PANTRY_CONFIG', 'Set a valid PANTRY_ORIGIN to connect Pantry.', 503) }
 const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(url.protocol === 'https:' || loopback && url.protocol === 'http:')) fail('PANTRY_CONFIG', 'Pantry requires a bare HTTPS origin, or HTTP on loopback.', 400)
 const token = env.PANTRY_AGENT_TOKEN?.trim()
 if (!token || !/^pantry_agent_[A-Za-z0-9_-]{32,}$/.test(token)) fail('PANTRY_CONFIG', 'Set a valid PANTRY_AGENT_TOKEN to connect Pantry.', 503)
 return { origin: url.origin, token }
}

async function request<T>(conn: ReturnType<typeof connection>, path: string, body?: unknown): Promise<T> {
 let response: Response
 try {
  response = await fetch(conn.origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
   headers: { authorization: `Bearer ${conn.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 } catch { fail('PANTRY_UNAVAILABLE', 'Pantry could not be reached. Refresh the saved submission before taking further action.', 502) }
 if (!response.ok) fail('PANTRY_REFUSED', `Pantry refused the request (HTTP ${response.status}). Check its token, accounts, evidence and accounting period.`, 502)
 try { return await response.json() as T } catch { fail('PANTRY_RESPONSE', 'Pantry returned an unreadable response. Refresh the saved submission.', 502) }
}

async function context(conn: ReturnType<typeof connection>) {
 const remote = await request<RemoteContext>(conn, '/api/pantry/agent/context')
 if (!remote || !Array.isArray(remote.accounts) || !Array.isArray(remote.documents) || !Array.isArray(remote.proposals)) fail('PANTRY_RESPONSE', 'Pantry returned incomplete accounting context.', 502)
 return remote
}
const saved = (c: Context, id: string) => one<Posting>(c, 'SELECT * FROM cf_payout_postings WHERE payout_id = ?', id)

async function record(c: Context, row: Posting, state: string, proposalId: string | null = row.proposal_id, journalId: string | null = null) {
 await commit(c, [sql("UPDATE cf_payout_postings SET state = ?, proposal_id = ?, external_id = ?, posted_at = ? WHERE payout_id = ? AND state <> 'posted' AND payload_hash = ? AND summary = ?",
  state, proposalId, journalId, state === 'posted' ? c.now : null, row.payout_id, row.payload_hash, row.summary)])
 return (await saved(c, row.payout_id))!
}

async function outcome(c: Context, row: Posting, p: Proposal) {
 if (!p || typeof p.id !== 'string' || !p.id || p.kind !== 'journal' || p.summary !== row.summary || !p.payload || await sha256(JSON.stringify(p.payload)) !== row.payload_hash) fail('PANTRY_RESPONSE', 'The Pantry proposal differs from this saved submission. Review it in Pantry.', 409)
 if (p.status === 'approved') {
  if (p.result_kind !== 'journal' || typeof p.result_id !== 'string' || !p.result_id) fail('PANTRY_RESPONSE', 'Pantry approval has no posted journal ID. Review it in Pantry.', 502)
  return record(c, row, 'posted', p.id, p.result_id)
 }
 if (!['proposed', 'rejected', 'stale'].includes(p.status)) fail('PANTRY_RESPONSE', 'Pantry returned an unknown proposal state.', 502)
 return record(c, row, p.status, p.id)
}

async function refresh(c: Context, conn: ReturnType<typeof connection>, row: Posting) {
 if (row.destination !== conn.origin) fail('PANTRY_INSTALLATION', 'Reconnect the Pantry installation that received this payout.', 409)
 if (!['sending', 'uncertain', 'proposed'].includes(row.state)) return row
 if (row.proposal_id) return outcome(c, row, await request<Proposal>(conn, `/api/pantry/agent/proposals/${encodeURIComponent(row.proposal_id)}`))
 const matches = (await context(conn)).proposals.filter(p => p.summary === row.summary)
 if (matches.length > 1) fail('PANTRY_DUPLICATE', 'Multiple Pantry proposals share this payout marker. Reconcile them in Pantry.', 409)
 // Context is bounded: absence is never evidence that an interrupted send failed.
 if (!matches.length) return record(c, row, 'uncertain')
 return outcome(c, row, matches[0])
}

/** File one journal proposal; a person approves and posts it inside Pantry. */
export async function postToPantry(c: Context, env: PaymentsEnv, view: any, documentId?: string) {
 if (managed(env)) fail('not_available', 'Pantry is not available yet on RER Managed.', 503)
 const id = text(view.payout.id, 'Payout ID', 200), previous = await saved(c, id)
 if (previous?.state === 'posted') return previous
 const conn = connection(env)
 if (previous) return refresh(c, conn, previous)
 const csv = evidenceCsv(view), evidenceHash = await sha256(csv), journal = payoutJournal(view, env), remote = await context(conn)
 const docId = text(documentId, 'Uploaded Pantry document ID', 200), doc = remote.documents.find(d => d.id === docId)
 if (!doc || !(doc.sha256?.toLowerCase() === evidenceHash || doc.text === csv)) fail('PANTRY_EVIDENCE', 'Upload the exact payout evidence CSV in Pantry Documents, then enter its document ID.', 409)
 const accountIds = [...new Set(journal.lines.map(l => l.accountId))]
 const refs = accountIds.map(accountId => {
  const a = remote.accounts.find(a => a.id === accountId)
  if (!a || !a.active || ['receivable', 'payable'].includes(a.subtype) || !a.revision) fail('PANTRY_MAPPING', 'Choose active Pantry accounts outside receivable/payable control accounts.', 409)
  return { kind: 'account', id: a.id, revision: a.revision }
 })
 const installation = (await sha256(String(env.AUTH_ORIGIN))).slice(0, 16)
 const summary = `coffer:${installation}:${id}:${evidenceHash}`
 if (summary.length > 300) fail('PANTRY_PAYLOAD', 'The payout reference exceeds Pantry’s summary limit.', 400)
 const payload = { date: journal.date, memo: `Coffer Stripe payout ${id}`.slice(0, 500), documentId: docId,
  passages: csv.split('\r\n').filter(Boolean).flatMap(line => line.match(/[\s\S]{1,2000}/g) ?? []),
  lines: journal.lines.map(({ accountId, debit, credit, memo }) => ({ accountId, debit, credit, memo })) }
 if (JSON.stringify(payload).length > 100_000) fail('PANTRY_PAYLOAD', 'This payout exceeds Pantry’s proposal size limit. Prepare its journal in Pantry.', 400)
 const hash = await sha256(JSON.stringify(payload)), known = remote.proposals.filter(p => p.summary === summary)
 if (known.length > 1 || known.length === 1 && await sha256(JSON.stringify(known[0].payload)) !== hash) fail('PANTRY_DUPLICATE', 'Pantry contains a different proposal for this payout. Reconcile it in Pantry.', 409)
 try {
  await commit(c, [guard('NOT EXISTS (SELECT 1 FROM cf_payout_postings WHERE payout_id = ?)', 'PAYOUT_CLAIMED', 'This payout already has a submission. Refresh its status.', id),
   guard("EXISTS(SELECT 1 FROM cf_payouts WHERE id=? AND status='paid' AND complete=1 AND amount_cents=?) AND (SELECT COUNT(*) FROM cf_payout_entries WHERE payout_id=?)=? AND NOT EXISTS(SELECT 1 FROM cf_payout_entries WHERE payout_id=? AND entry_id NOT IN (SELECT value FROM json_each(?)))", 'PAYOUT_CHANGED', 'The payout changed. Download fresh evidence before posting.', id, view.payout.amount_cents, id, view.lines.length, id, JSON.stringify(view.lines.map((line: any) => line.id))),
   sql("INSERT INTO cf_payout_postings(payout_id,state,external_id,destination,posted_at,proposal_id,payload_hash,summary,created_at) VALUES(?,'sending',NULL,?,NULL,NULL,?,?,?)", id, conn.origin, hash, summary, c.now)])
 } catch (error) {
  if (!(error instanceof CofferError) || error.code !== 'PAYOUT_CLAIMED') throw error
  return (await saved(c, id))!
 }
 const claimed = (await saved(c, id))!
 try {
  const proposal = known[0] ?? await request<Proposal>(conn, '/api/pantry/agent/proposals', { kind: 'journal', summary, payload, refs })
  return await outcome(c, claimed, proposal)
 } catch (error) {
  if (error instanceof CofferError && error.code === 'SESSION_CHANGED') throw error
  // Even a malformed success can follow acceptance. Do not send the payout twice.
  return record(c, claimed, 'uncertain')
 }
}

/** Verify the exact saved proposal without resubmitting or creating money.
 * Posted rows are checked too: approval and its immutable journal ID must agree. */
export async function reconciliationPosting(c: Context, env: PaymentsEnv, payoutId: string) {
 if (managed(env)) fail('not_available', 'Pantry is not available yet on RER Managed.', 503)
 const row = await saved(c, payoutId)
 if (!row) return null
 const conn = connection(env)
 if (row.destination !== conn.origin) fail('PANTRY_INSTALLATION', 'Reconnect the Pantry installation that received this payout.', 409)
 if (!row.proposal_id) {
  if (row.state === 'posted') fail('PANTRY_RESPONSE', 'This posted payout has no verifiable Pantry proposal ID.', 409)
  return refresh(c, conn, row)
 }
 const proposal = await request<Proposal>(conn, `/api/pantry/agent/proposals/${encodeURIComponent(row.proposal_id)}`)
 if (proposal.id !== row.proposal_id) fail('PANTRY_RESPONSE', 'Pantry returned a different proposal ID.', 409)
 if (row.state === 'posted' && (proposal.status !== 'approved' || proposal.result_kind !== 'journal' || proposal.result_id !== row.external_id)) fail('PANTRY_RESPONSE', 'The saved Pantry journal no longer matches its approval.', 409)
 return outcome(c, row, proposal)
}
