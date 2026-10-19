import { restrictionLabel } from '../restricted-funds'
import { date, fail, integer, sha256, text } from '../db'
import type { PaymentsEnv } from './pantry'

export type JournalLine = { accountId: string; debit: string; credit: string; memo: string; fund: string }
export const dollars = (value: number) => `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`

/** Spreadsheet text never becomes a formula, including leading whitespace. */
const safeText = (value: unknown) => {
 const s = String(value ?? '')
 return /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s
}
const csvCell = (value: unknown, numeric = false) => `"${(numeric ? String(value ?? '') : safeText(value)).replace(/"/g, '""')}"`
const csv = (rows: unknown[][], numeric: number[] = []) => rows.map((row, i) => row.map((v, col) => csvCell(v, i > 0 && numeric.includes(col))).join(',')).join('\r\n') + '\r\n'

export function mapping(value: string | undefined, label: string): Record<string, string> {
 let parsed: unknown
 try { parsed = JSON.parse(value ?? '{}') } catch { fail('PAYMENT_MAPPING', `${label} must be a JSON object.`, 400) }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(v => typeof v !== 'string' || !v.trim())) fail('PAYMENT_MAPPING', `${label} must map names to nonempty account values.`, 400)
 return parsed as Record<string, string>
}
const mapped = (map: Record<string, string>, key: string, label: string) => {
 if (!Object.hasOwn(map, key)) fail('PAYMENT_MAPPING', `Map ${label} before exporting or submitting this payout.`, 400)
 return text(map[key], label, 200)
}

/** Exact evidence bytes are independent of account mapping and submission state. */
export function evidenceCsv(view: any): string {
 const p = view.payout
 const rows: unknown[][] = [['Payout ID', 'Arrival date', 'Currency', 'Source ID', 'Kind', 'Fund', 'Gross', 'Fees', 'Net', 'Gift ID', 'Restriction']]
 for (const l of [...view.accountingLines].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  rows.push([p.id, p.arrival_on, p.currency, l.source_id, l.kind, l.fund, dollars(l.amount_cents), dollars(l.fee_cents), dollars(l.net_cents), l.gift_id, restrictionLabel(l)])
 }
 return csv(rows, [6, 7, 8])
}

export function payoutJournal(view: any, env: PaymentsEnv): { date: string; lines: JournalLine[] } {
 const p = view.payout
 if (p.status !== 'paid' || String(p.currency).toLowerCase() !== 'usd') fail('PAYOUT_NOT_READY', 'Only paid USD payouts can be posted or exported.')
 integer(p.amount_cents, 'Payout amount', -Number.MAX_SAFE_INTEGER)
 if (!p.complete || p.matched_cents !== p.amount_cents) fail('PAYOUT_NOT_READY', 'Match every payout transaction before posting or exporting.')
 const day = date(p.arrival_on, 'Payout arrival date'), funds = mapping(env.PANTRY_FUND_ACCOUNTS, 'PANTRY_FUND_ACCOUNTS')
 const deposit = text(env.PANTRY_DEPOSIT_ACCOUNT, 'Deposit account', 200), lines: JournalLine[] = []
 const add = (accountId: string, signed: number, memo: string, fund = '') => {
  integer(signed, 'Journal amount', -Number.MAX_SAFE_INTEGER)
  if (signed) lines.push({ accountId, debit: dollars(Math.max(0, signed)), credit: dollars(Math.max(0, -signed)), memo: memo.slice(0, 500), fund })
 }
 add(deposit, p.amount_cents, `Stripe payout ${p.id}`)
 let gross = 0, fees = 0, net = 0
 for (const s of [...view.splits].sort((a, b) => String(a.fund).localeCompare(String(b.fund)))) {
  const fund = text(s.fund, 'Fund', 200), accountId = mapped(funds, fund, `fund ${fund}`)
  integer(s.gross_cents, 'Fund gross', -Number.MAX_SAFE_INTEGER)
  integer(s.fee_cents, 'Fund fees', -Number.MAX_SAFE_INTEGER)
  integer(s.net_cents, 'Fund net', -Number.MAX_SAFE_INTEGER)
  if (s.gross_cents - s.fee_cents !== s.net_cents) fail('PAYOUT_NOT_READY', 'The payout fund split does not balance.')
  gross += s.gross_cents; fees += s.fee_cents; net += s.net_cents
  add(accountId, -s.gross_cents, `${restrictionLabel(s)} · ${fund} · Stripe gifts and refunds ${p.id}`, fund)
  if (s.fee_cents) add(text(env.PANTRY_FEE_ACCOUNT, 'Stripe fee account', 200), s.fee_cents, `Stripe fees · ${fund} · ${p.id}`, fund)
 }
 if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(fees) || net !== p.amount_cents || gross - fees !== p.amount_cents || lines.length < 2 || lines.length > 200) fail('PAYOUT_NOT_READY', 'The payout requires a balanced journal of 2–200 lines.')
 return { date: day, lines }
}

function exportLines(view: any, env: PaymentsEnv) {
 const journal = payoutJournal(view, env), names = mapping(env.QBO_ACCOUNT_NAMES, 'QBO_ACCOUNT_NAMES')
 return { ...journal, lines: journal.lines.map(l => ({ ...l, name: mapped(names, l.accountId, `QuickBooks account ${l.accountId}`) })) }
}

// Both QuickBooks formats accept a 20-character journal reference. Keep the
// full processor ID in every memo, with a deterministic compact document key.
const accountingReference = async (id: string) => 'CF-' + (await sha256(id)).slice(0, 17)

export async function qboCsv(view: any, env: PaymentsEnv): Promise<string> {
 return journalsCsv([view], env)
}

export async function journalsCsv(views: any[], env: PaymentsEnv): Promise<string> {
 const rows: unknown[][] = [['Journal No', 'Journal Date', 'Account Name', 'Debits', 'Credits', 'Description', 'Name', 'Class', 'Location']]
 for (const view of views) {
  const j = exportLines(view, env), reference = await accountingReference(view.payout.id)
  rows.push(...j.lines.map(l => [reference, j.date, l.name, l.debit === '0.00' ? '' : l.debit, l.credit === '0.00' ? '' : l.credit, l.memo, '', l.fund, '']))
 }
 return csv(rows, [3, 4])
}

export async function journalIif(view: any, env: PaymentsEnv): Promise<string> {
 return journalsIif([view], env)
}

export async function journalsIif(views: any[], env: PaymentsEnv): Promise<string> {
 const cell = (v: unknown) => {
  const s = safeText(v)
  if (/[\t\r\n]/.test(s)) fail('PAYMENT_EXPORT', 'IIF fields cannot contain tabs or line breaks.', 400)
  return s
 }
 let sequence = 0
 const rows = ['!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLASS', '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLASS', '!ENDTRNS']
 for (const view of views) {
  const j = exportLines(view, env), day = `${j.date.slice(5, 7)}/${j.date.slice(8, 10)}/${j.date.slice(0, 4)}`, reference = await accountingReference(view.payout.id)
  j.lines.forEach((l, i) => rows.push([i ? 'SPL' : 'TRNS', ++sequence, 'GENERAL JOURNAL', day, cell(l.name), '', l.debit !== '0.00' ? l.debit : `-${l.credit}`, reference, cell(l.memo), cell(l.fund)].join('\t')))
  rows.push('ENDTRNS')
 }
 return rows.join('\r\n') + '\r\n'
}
