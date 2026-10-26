import { acknowledgmentPredicate } from './acknowledgment-filters'
import { requireRole } from './auth'
import { customDisplay, customFields } from './custom-fields'
import { all, date, fail, integer, type Context, type Row } from './db'
import { centsDecimal } from './money'

type CustomValue = string | string[] | null
export type CustomReportRecord = {
 id: string; originalId: string; donorId: string; donorName: string
 receivedOn: string; kind: string; amountCents: number
 value: CustomValue; displayValue: string
}
export type CustomReportGroup = {
 value: CustomValue; displayValue: string; amountCents: number; giftCount: number
}
export type CustomReport = {
 fields: Row[]; field: Row | null; from: string | null; through: string | null
 groups: CustomReportGroup[]; records: CustomReportRecord[]; totalCents: number; giftCount: number
}

/** Stored custom values are normalized by their write doors. A pick-many
 * combination is one group, independent of the order its choices were picked. */
function groupValue(stored: string | null): CustomValue {
 const value: CustomValue = stored === null ? null : JSON.parse(stored)
 return Array.isArray(value) ? [...new Set(value)].sort() : value
}

function checkedCents(value: bigint): number {
 if (value < -BigInt(Number.MAX_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
  fail('REPORT_AMOUNT', 'The report total exceeds the exact cents range. Choose a shorter date range.', 400)
 }
 return integer(Number(value), 'Report contribution cents', -Number.MAX_SAFE_INTEGER)
}

/** A deliberately narrow DONOR-005 report: one gift custom column/grouping.
 * Entry dates select ledger movements; adjustments inherit the original gift's
 * current custom value. No allocations, soft credits or display pagination
 * enter this query, so every contribution and original gift counts once. */
export async function customRecordSelection(c: Context, url: URL) {
 requireRole(c.actor, ['owner', 'admin'], 'read custom field gifts reports')
 const from = url.searchParams.get('from') || null, through = url.searchParams.get('through') || null
 if (from) date(from, 'From')
 if (through) date(through, 'Through')
 if (from && through && from > through) fail('INPUT', 'From must be on or before Through.', 400)
 const fields = (await customFields(c)).filter(f => f.kind === 'gift')
 const key = url.searchParams.get('field') || null
 const selected = key ? fields.find(f => f.key === key) : fields[0]
 if (key && !selected) fail('INPUT', 'Choose a defined gift custom field.', 400)
 const field = selected ?? null
 const acknowledgment=acknowledgmentPredicate(url,'COALESCE(l.reverses,p.gift_id,l.id)')


 const query = `SELECT l.id,l.fund,NULL AS campaign_id,l.donor_id,d.name AS donor_name,l.received_on,l.kind,
  CAST(l.amount_cents AS TEXT) AS amount_cents,
  COALESCE(l.reverses,p.gift_id,l.id) AS original_id,COALESCE(l.reverses,p.gift_id,l.id) AS gift_id,v.value AS custom_value
  FROM cf_contribution_ledger l JOIN cf_donors d ON d.id=l.donor_id
  LEFT JOIN cf_payment_entries p ON l.source='stripe-adjustment' AND p.id=l.id
  LEFT JOIN cf_custom_values v ON v.field_key=? AND v.record_id=COALESCE(l.reverses,p.gift_id,l.id)
   AND v.donor_id=l.donor_id AND d.erased_at IS NULL
  WHERE ? IS NOT NULL AND (? IS NULL OR l.received_on>=?) AND (? IS NULL OR l.received_on<=?) AND ${acknowledgment.sql}
  ORDER BY l.received_on DESC,l.created_at DESC,l.id`
 return {query,params:[field?.key??null,field?.key??null,from,from,through,through,...acknowledgment.params],fields,field,from,through,parameters:{field:field?.key??null,from,through,...acknowledgment.filters}}
}

export async function report(c: Context, url: URL): Promise<CustomReport> {
 const {query,params,fields,field,from,through}=await customRecordSelection(c,url)
 if(!field)return {fields,field,from,through,groups:[],records:[],totalCents:0,giftCount:0}
 const entries=await all(c,query,...params)

 const grouped = new Map<string, { value: CustomValue; displayValue: string; cents: bigint; gifts: Set<string> }>()
 const gifts = new Set<string>(), records: CustomReportRecord[] = []
 let total = 0n
 for (const entry of entries) {
  const value = groupValue(entry.custom_value), key = JSON.stringify(value), displayValue = customDisplay(field, value)
  const amount = BigInt(entry.amount_cents), originalId = String(entry.original_id)
  const group = grouped.get(key) ?? { value, displayValue, cents: 0n, gifts: new Set<string>() }
  group.cents += amount; group.gifts.add(originalId); grouped.set(key, group)
  total += amount; gifts.add(originalId)
  records.push({ id: entry.id, originalId, donorId: entry.donor_id, donorName: entry.donor_name,
   receivedOn: entry.received_on, kind: entry.kind, amountCents: checkedCents(amount), value, displayValue })
 }
 const groups = [...grouped.values()].map(g => ({ value: g.value, displayValue: g.displayValue,
  amountCents: checkedCents(g.cents), giftCount: g.gifts.size }))
  .sort((a, b) => a.value === null ? (b.value === null ? 0 : 1) : b.value === null ? -1 : a.displayValue.localeCompare(b.displayValue))
 return { fields, field, from, through, groups, records, totalCents: checkedCents(total), giftCount: gifts.size }
}

/** Private download data includes both the grouping and its complete ledger
 * evidence. Text cells cannot execute spreadsheet formulas, including after
 * leading whitespace; the two money columns retain exact integer/decimal cents. */
export function reportCsv(data: CustomReport): string {
 const rows: unknown[][] = [['Row type', 'Field key', 'Field label', 'Value', 'Value JSON', 'Original gift ID', 'Entry ID', 'Received on', 'Donor', 'Kind', 'Contribution cents', 'Contribution USD', 'Gifts']]
 const field = data.field
 if (field) {
  for (const g of data.groups) rows.push(['Group', field.key, field.label, g.value === null ? 'Not set' : g.displayValue,
   JSON.stringify(g.value), '', '', '', '', '', g.amountCents, centsDecimal(String(g.amountCents)), g.giftCount])
  rows.push(['Total', field.key, field.label, '', '', '', '', '', '', '', data.totalCents, centsDecimal(String(data.totalCents)), data.giftCount])
  for (const r of data.records) rows.push(['Entry', field.key, field.label, r.value === null ? 'Not set' : r.displayValue,
   JSON.stringify(r.value), r.originalId, r.id, r.receivedOn, r.donorName, r.kind, r.amountCents, centsDecimal(String(r.amountCents)), ''])
 }
 return rows.map((row, index) => row.map((value, column) => {
  let cell = String(value ?? '')
  if (!(index > 0 && [10, 11, 12].includes(column)) && /^\s*[=+\-@]/.test(cell)) cell = "'" + cell
  return `"${cell.replace(/"/g, '""')}"`
 }).join(',')).join('\r\n') + '\r\n'
}
