import { all, fail, guard, one, sha256, type Context, type Row, type Stmt } from '../../db'
import { restrictionLabel } from '../../restricted-funds'
import { batchDeposit } from '../batch-deposits'
import { payoutDetail } from '../payouts'
import type { QboConnection } from './client'

export type QboDocument = { kind: string; sourceId: string; entity: 'Deposit' | 'JournalEntry'; payload: Row }
export type QboBundle = { documents: QboDocument[]; guards: Stmt[]; amountCents: number }
const amount = (cents: number) => {
 if (!Number.isSafeInteger(cents)) fail('QBO_AMOUNT', 'QuickBooks amounts must be exact cents.', 409)
 return cents / 100
}
export async function prepareDeposit(c: Context, conn: QboConnection, kind: string, sourceId: string): Promise<QboBundle> {
 if (!['payout', 'batch'].includes(kind)) fail('QBO_SOURCE', 'Choose a payout or a closed check batch.', 400)
 const saved = await one(c, 'SELECT * FROM cf_qbo_mapping WHERE id=1 AND realm_id=? AND sandbox=?', conn.realm, conn.sandbox ? 1 : 0)
 if (!saved) fail('QBO_MAPPING', 'Save the fund and bank mappings for this QuickBooks company.', 409)
 const m = JSON.parse(saved.mapping), documents: QboDocument[] = [], guards = [guard('EXISTS(SELECT 1 FROM cf_qbo_mapping WHERE id=1 AND version=?)', 'QBO_MAPPING_CHANGED', 'The QuickBooks mapping changed. Review the deposit again.', saved.version)]
 let day: string, total: number, lines: Row[], adjustments: Row[] = []
 if (kind === 'batch') {
  const view = await batchDeposit(c, sourceId), b = view.batch
  if (b.status !== 'closed' || !view.lines.length || view.lines.reduce((n, l) => n + l.amount_cents, 0) !== b.expected_cents) fail('BATCH_NOT_READY', 'Close a balanced check or cash batch before posting.', 409)
  day = b.received_on; total = b.expected_cents
  lines = view.splits.map(s => ({ ...s, amount_cents: s.gross_cents, fee_cents: 0 }))
  guards.push(guard("EXISTS(SELECT 1 FROM cf_gift_batches WHERE id=? AND status='closed' AND version=?)", 'BATCH_CHANGED', 'The check batch changed. Review it again.', sourceId, b.version), ...view.lines.map(l => guard('EXISTS(SELECT 1 FROM cf_gifts WHERE id=? AND version=?)', 'BATCH_CHANGED', 'A batch gift changed. Review it again.', l.gift_id, l.version)))
 } else {
  const view = await payoutDetail(c, sourceId), p = view.payout
  if (p.status !== 'paid' || p.currency !== 'usd' || !p.complete || !view.lines.length || p.matched_cents !== p.amount_cents) fail('PAYOUT_NOT_READY', 'Match every transaction in a paid USD payout before posting.', 409)
  day = p.arrival_on; total = p.amount_cents
  lines = view.accountingLines.filter(l => l.kind === 'charge')
  adjustments = view.accountingLines.filter(l => ['refund', 'refund_reversal', 'dispute', 'dispute_reversal'].includes(l.kind))
  if (lines.length + adjustments.length !== view.accountingLines.length) fail('QBO_ADJUSTMENT', 'This payout includes an unsupported processor adjustment. Review it before posting.', 409)
  guards.push(guard('EXISTS(SELECT 1 FROM cf_payouts WHERE id=? AND status=\'paid\' AND complete=1 AND amount_cents=?) AND (SELECT COUNT(*) FROM cf_payout_entries WHERE payout_id=?)=?', 'PAYOUT_CHANGED', 'The payout changed. Review it again.', sourceId, total, sourceId, view.lines.length))
 }
 if (total <= 0) fail('QBO_AMOUNT', 'QuickBooks deposits require a positive net amount. Reconcile a net withdrawal separately.', 409)
 const funds = [...new Set([...lines, ...adjustments].map(l => l.fund))]
 for (const fund of funds) if (!Object.hasOwn(m.funds, fund)) fail('QBO_MAPPING', `Map fund ${fund} before posting.`, 409)
 const locations = [...new Set(funds.map(f => m.funds[f].locationId).filter(Boolean))]
 if (locations.length > 1) fail('QBO_LOCATION', 'QuickBooks permits one location per deposit. Map these funds to line classes and one shared location.', 409)
 const dimensions = locations.length ? { DepartmentRef: { value: locations[0] } } : {}
 const detail = (fund: string, account: string) => ({ AccountRef: { value: account }, ...(m.funds[fund].classId ? { ClassRef: { value: m.funds[fund].classId } } : {}) })
 const depositLines: Row[] = []
 const addDeposit = (cents: number, fund: string, account: string, description: string) => {
  if (cents) depositLines.push({ Amount: amount(cents), Description: description, DetailType: 'DepositLineDetail', DepositLineDetail: detail(fund, account) })
 }
 const byFund = new Map<string, Row>()
 for (const l of lines) {
  const f = byFund.get(l.fund) ?? { ...l, amount_cents: 0, fee_cents: 0 }
  f.amount_cents += l.amount_cents; f.fee_cents += l.fee_cents; byFund.set(l.fund, f)
 }
 for (const [fund, l] of [...byFund].sort(([a], [b]) => a.localeCompare(b))) {
  addDeposit(l.amount_cents, fund, m.funds[fund].accountId, `${fund} · ${restrictionLabel(l)}`)
  addDeposit(-l.fee_cents, fund, m.fees, `Processing fees · ${fund}`)
 }
 const entryIds = [...new Set(adjustments.map(l => l.id))]
 for (const id of entryIds) {
  const parts = adjustments.filter(l => l.id === id), first = parts[0], journal: Row[] = []
  const addJournal = (signedDebit: number, fund: string, account: string, description: string) => {
   if (signedDebit) journal.push({ Amount: amount(Math.abs(signedDebit)), Description: description, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { ...detail(fund, account), ...(m.funds[fund].locationId ? { DepartmentRef: { value: m.funds[fund].locationId } } : {}), PostingType: signedDebit > 0 ? 'Debit' : 'Credit' } })
  }
  for (const l of parts) {
   addJournal(-l.amount_cents, l.fund, m.funds[l.fund].accountId, `${l.kind} · ${l.source_id} · ${restrictionLabel(l)}`)
   addJournal(l.fee_cents, l.fund, m.fees, `${l.kind} fees · ${l.source_id}`)
   addJournal(l.net_cents, l.fund, m.stripe, `${l.kind} · Stripe clearing`)
   addDeposit(l.net_cents, l.fund, m.stripe, `${l.kind} · ${l.source_id} · separate journal`)
  }
  const balance = journal.reduce((n, l) => n + Math.round(l.Amount * 100) * (l.JournalEntryLineDetail.PostingType === 'Debit' ? 1 : -1), 0)
  if (balance || !journal.length) fail('QBO_AMOUNT', 'The adjustment journal does not balance.', 409)
  documents.push({ kind: 'adjustment', sourceId: id, entity: 'JournalEntry', payload: { TxnDate: first.received_on, PrivateNote: `Coffer ${first.kind} ${first.source_id}`, CurrencyRef: { value: 'USD' }, Line: journal } })
 }
 if (depositLines.reduce((n, l) => n + Math.round(l.Amount * 100), 0) !== total) fail('QBO_AMOUNT', 'The QuickBooks deposit differs from Coffer.', 409)
 documents.push({ kind, sourceId, entity: 'Deposit', payload: { TxnDate: day, PrivateNote: `Coffer ${kind} ${sourceId}`, CurrencyRef: { value: 'USD' }, DepositToAccountRef: { value: m.bank }, ...dimensions, Line: depositLines } })
 for (const doc of documents) {
  if (doc.payload.Line.length > 200) fail('QBO_SIZE', 'This deposit exceeds the supported QuickBooks line count.', 409)
  doc.payload.DocNumber = 'CF-' + (await sha256(`${doc.kind}:${doc.sourceId}`)).slice(0, 17)
 }
 return { documents, guards, amountCents: total }
}

/** Provider-generated fields are ignored; every financial and dimension value
 * must still match the immutable request before a posting is called posted. */
export function verifyDocument(entity: string, payload: Row, response: Row): Row {
 const remote = response[entity]
 const pick = (l: Row) => {
  const d = l[l.DetailType]
  return [Math.round(l.Amount * 100), l.DetailType, d?.AccountRef?.value, d?.ClassRef?.value ?? null, d?.DepartmentRef?.value ?? null, d?.PostingType ?? null]
 }
 const sorted = (lines: Row[]) => lines.map(pick).map(l => JSON.stringify(l)).sort()
 if (!remote?.Id || !Array.isArray(remote.Line) || remote.TxnDate !== payload.TxnDate || remote.DocNumber !== payload.DocNumber || (remote.CurrencyRef?.value ?? 'USD') !== 'USD' || (remote.DepartmentRef?.value ?? null) !== (payload.DepartmentRef?.value ?? null) || JSON.stringify(sorted(remote.Line)) !== JSON.stringify(sorted(payload.Line))) fail('QBO_RESPONSE', 'QuickBooks returned different dates, lines or dimensions. The saved request remains unresolved.', 502)
 if (entity === 'Deposit' && (remote.DepositToAccountRef?.value !== payload.DepositToAccountRef.value || Math.round(remote.TotalAmt * 100) !== payload.Line.reduce((n: number, l: Row) => n + Math.round(l.Amount * 100), 0))) fail('QBO_RESPONSE', 'QuickBooks returned a different bank deposit total. The saved request remains unresolved.', 502)
 return remote
}
