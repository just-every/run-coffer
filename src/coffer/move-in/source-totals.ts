import { SourceRow, day, money } from './source-rows'
import type { ImportTotals, ParsedImport, Total } from './types'

export function emptyTotals(): ImportTotals { return { giftCount: 0, amountCents: 0, byYear: Object.create(null), byFund: Object.create(null), byDonor: Object.create(null), complete: true } }
function add(group: Record<string, Total>, key: string, cents: number) {
 const total = group[key] ??= { giftCount: 0, amountCents: 0 }; total.giftCount++; total.amountCents += cents
}
export function accumulate(totals: ImportTotals, cents: number, date: string, fund: string, donor: string) {
 totals.giftCount++; totals.amountCents += cents
 add(totals.byYear, date.slice(0, 4), cents); add(totals.byFund, fund, cents); add(totals.byDonor, donor, cents)
}
/** Independent pass over source cash rows, before normalizing or resolving entities. */
export function sourceTotals(rows: SourceRow[], totals: ImportTotals) {
 for (const r of rows) {
  if(['givebutter','zeffy'].includes(r.result.source)&&r.peek('planId'))continue
  if (r.kind() === 'unsupported') { totals.complete = false; continue }
  if (r.kind() !== 'gift') continue
  const cents = money(r.raw('amount')), date = day(r.raw('date'))
  if (cents === null || cents === 0 || !date || !r.peek('donorId')) totals.complete = false
  accumulate(totals, cents ?? 0, date || 'unknown', r.peek('fund'), r.peek('donorId'))
 }
}
export function controlRow(r: SourceRow, out: ParsedImport) {
 const giftCountText = r.get('controlCount'), amountText = r.get('controlAmount')
 const giftCount = giftCountText && /^\d+$/.test(giftCountText) && Number.isSafeInteger(Number(giftCountText)) ? Number(giftCountText) : null
 const amountCents = amountText ? r.cents('controlAmount', true) : null
 if (giftCountText && giftCount === null) r.error('CONTROL_COUNT', 'Exported gift count must be a whole non-negative integer.')
 const year = r.get('controlYear'), fund = r.get('fund'), donor = r.get('donorId')
 if ([year, fund, donor].filter(Boolean).length > 1) r.error('CONTROL_SCOPE', 'Export one control grouping (year, fund, or constituent) per row.')
 const scope = year ? 'year' : fund ? 'fund' : donor ? 'donor' : 'all', key = year || fund || donor || ''
 const groups = { year: out.sourceTotals.byYear, fund: out.sourceTotals.byFund, donor: out.sourceTotals.byDonor }
 const actual = scope === 'all' ? { giftCount: out.sourceTotals.giftCount, amountCents: out.sourceTotals.amountCents } : groups[scope][key] || { giftCount: 0, amountCents: 0 }
 const matches = out.sourceTotals.complete && (giftCount !== null || amountCents !== null) && (giftCount === null || giftCount === actual.giftCount) && (amountCents === null || amountCents === actual.amountCents)
 out.controlTotals.push({ location: r.location, scope, key, giftCount, amountCents, actual, matches })
 if (!matches) out.diagnostics.push({ ...r.location, severity: 'warning', code: 'CONTROL_MISMATCH', message: 'Exported report control total does not match the supplied received gift rows. Check date/type filters and export completeness.' })
 r.finish()
}
function sameGroup(a: Record<string, Total>, b: Record<string, Total>) {
 const keys = new Set([...Object.keys(a), ...Object.keys(b)])
 return [...keys].every(key => a[key]?.giftCount === b[key]?.giftCount && a[key]?.amountCents === b[key]?.amountCents)
}
export function validateImport(out: ParsedImport) {
 for (const gift of out.gifts) accumulate(out.mappedTotals, gift.amountCents, gift.receivedOn, gift.fund, gift.donorExternalId)
 const a = out.sourceTotals, b = out.mappedTotals
 if (!a.complete || a.giftCount !== b.giftCount || a.amountCents !== b.amountCents || !sameGroup(a.byYear, b.byYear) || !sameGroup(a.byFund, b.byFund) || !sameGroup(a.byDonor, b.byDonor)) {
  out.mappedTotals.complete = false
  out.diagnostics.push({ severity: 'warning', code: 'RECONCILIATION', message: 'Raw received gift totals and mapped gift totals do not reconcile by count, cents, year, fund, and constituent.' })
 }
 const donors = new Set(out.donors.map(d => d.externalId)), gifts = new Map(out.gifts.map(g => [g.externalId, g])), pledges = new Map(out.pledges.map(p => [p.externalId, p]))
 const missing = (row: { location: object }, kind: string, id: string) => out.diagnostics.push({ ...row.location, severity: 'error', code: 'MISSING_REFERENCE', column: `${kind} ID`, message: `${kind} ${id || '(empty)'} is missing from the supplied exports. Include the ${kind.toLowerCase()} row with this ID in its export, or correct this row's linked ID.${out.source === 'lgl' && /constituent/i.test(kind) ? ' The constituents report must include its name; names in other reports are only labels.' : ''}` })
 for (const collection of [out.gifts, out.relationships, out.softCredits, out.pledges, out.installments, out.notes, out.solicitations??[], out.channelWithdrawals??[]]) {
  const ids = new Set<string>()
  for (const row of collection) {
   if (ids.has(row.externalId)) out.diagnostics.push({ ...row.location, severity: 'error', code: 'DUPLICATE_ID', column: 'Record ID', message: `Duplicate source record ID ${row.externalId}. Delete the repeated row if it is the same record. For separate joined or split records, export a distinct source record ID for each.` })
   ids.add(row.externalId)
   if ('donorExternalId' in row && !donors.has(row.donorExternalId)) missing(row, 'Constituent', row.donorExternalId)
   if ('relatedDonorExternalId' in row && !donors.has(row.relatedDonorExternalId)) missing(row, 'Related constituent', row.relatedDonorExternalId)
   // A pledge payment may pay a pledge an earlier move-in brought (another year's file); the review plan checks those against Coffer.
   if ('pledgeExternalId' in row && row.pledgeExternalId && !pledges.has(row.pledgeExternalId) && collection !== out.gifts) missing(row, 'Pledge', row.pledgeExternalId)
  }
 }
 for (const credit of out.softCredits) {
  const gift = gifts.get(credit.giftExternalId)
  if (!gift) missing(credit, 'Received gift', credit.giftExternalId)
  else if (credit.amountCents > gift.amountCents) out.diagnostics.push({ ...credit.location, severity: 'error', code: 'SOFT_AMOUNT', column: 'Amount', message: `Soft credit ${credit.externalId} exceeds gift ${gift.externalId}. Set the credit Amount to no more than the gift amount, or correct its Related Gift ID if it recognizes a different gift.` })
 }
 for (const pledge of out.pledges) {
  const installments = out.installments.filter(i => i.pledgeExternalId === pledge.externalId)
  for (const i of installments) if (i.dueOn < pledge.pledgedOn) out.diagnostics.push({ ...i.location, severity: 'error', code: 'INSTALLMENT_DATE', column: 'Due Date', message: `Installment date precedes pledge ${pledge.externalId}'s date. Set Due Date on or after ${pledge.pledgedOn}, or correct the pledge date if it is wrong.` })
 }
 for (const r of out.relationships) if (r.donorExternalId === r.relatedDonorExternalId || !['spouse','employer','board_member','foundation_officer','introduced_by'].includes(r.type))
  out.diagnostics.push({ ...r.location, severity: 'error', code: 'RELATIONSHIP', column: 'Relationship Type / Related Constituent ID', message: `Relationship ${r.externalId} needs two different constituents and a supported type. Correct Related Constituent ID and use Spouse, Employer, Board member, Foundation officer or Introduced by; otherwise remove this relationship row.` })
 if (out.unmapped.length) out.diagnostics.push({ severity: 'warning', code: 'UNMAPPED', message: `${out.unmapped.length} source field(s) remain unmapped. Review each field before importing.` })
}
