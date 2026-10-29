import { columnFields, normalizeLabel } from './source-columns'
import type { Cell, ParsedImport, SourceLocation, Table } from './types'

export function valueText(value: Cell | undefined): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim() }
export function money(value: Cell | undefined): number | null {
 const text = valueText(value).replace(/^\$/, '')
 if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null
 const [whole, fraction = ''] = text.replace(/,/g, '').split('.')
 const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
 return Number.isSafeInteger(cents) ? cents : null
}
export function day(value: Cell | undefined): string {
 if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
 const text = valueText(value), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text), us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
 if (!iso && !us) return ''
 const normalized = iso ? text : `${us![3]}-${us![1].padStart(2, '0')}-${us![2].padStart(2, '0')}`
 const date = new Date(`${normalized}T00:00:00Z`)
 return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : ''
}
export type RowKind = 'donor' | 'gift' | 'pledge' | 'softCredit' | 'installment' | 'relationship' | 'note' | 'control' | 'volunteering' | 'unsupported'
export class SourceRow {
 readonly location: SourceLocation
 readonly used = new Set<number>()
 private readonly fields = new Map<string, number>()
 readonly headers: string[]
 constructor(readonly table: Table, readonly cells: Cell[], row: number, readonly result: ParsedImport) {
  this.location = { file: table.file, sheet: table.sheet, row }
  this.headers = table.rows[0].map(valueText)
  const aliases = columnFields(result.source)
  for (let i = 0; i < this.headers.length; i++) {
   const mapping=result.spreadsheet
   const field = mapping ? mapping.columns.find(c=>c.column===this.headers[i]&&(!c.sheet||c.sheet===table.sheet))?.field : aliases.get(normalizeLabel(this.headers[i]))
   if (field) { if (!this.fields.has(field)) this.fields.set(field, i); else this.error('DUPLICATE_COLUMN', `Columns map to the same field ${field}; export a single unambiguous column.`, this.headers[i]) }
  }
 }
 has(field: string) { return this.fields.has(field) }
 raw(field: string): Cell | undefined { const i = this.fields.get(field); return i === undefined ? undefined : this.cells[i] }
 peek(field: string) { const value=valueText(this.raw(field)),translations=this.result.spreadsheet?.translations; const values=field==='fund'?translations?.fund:field==='method'?translations?.method:undefined; return values&&Object.hasOwn(values,value)?values[value]:value }
 get(field: string) { const i = this.fields.get(field); if (i !== undefined) this.used.add(i); return this.peek(field) }
 // Source household overrides keep the exact exported wording and spacing.
 verbatim(field: string) { this.get(field); const value = this.raw(field); return value === undefined || value === null ? '' : String(value) }
 date(field: string) { this.get(field); const date = day(this.raw(field)); if (!date) this.error('DATE', `${field} must be a real YYYY-MM-DD or MM/DD/YYYY date.`, field); return date }
 cents(field: string, allowZero = false) { this.get(field); const n = money(this.raw(field)); if (n === null || (!allowZero && n === 0)) { this.error('AMOUNT', `${field} must be a ${allowZero ? 'non-negative' : 'positive'} amount with at most two decimal places.`, field); return null } return n }
 required(field: string) { const text = this.get(field); if (!text) this.error('REQUIRED', `Missing ${field}; export this field from the source CRM.`, field); return text }
 error(code: string, message: string, column?: string) {
  const index = column ? this.fields.get(column) : undefined
  this.result.diagnostics.push({ ...this.location, severity: 'error', code, message, column: index === undefined ? column : this.headers[index] })
 }
 unmap(column: string, value: string, reason: string) { this.result.unmapped.push({ ...this.location, column, value, reason }) }
 finish() {
  for (let i = 0; i < this.cells.length; i++) if (valueText(this.cells[i]) && !this.used.has(i)) this.unmap(this.headers[i] || `Column ${i + 1}`, valueText(this.cells[i]), `Coffer has no place for “${this.headers[i] || `column ${i + 1}`}” on a ${this.kindLabel()} row, so it would be left out. Delete that column from the file and upload again, or keep it and say below that it can be left out.`)
 }
 kindLabel() { return ({ donor: 'constituent', gift: 'gift', pledge: 'pledge', softCredit: 'soft credit', installment: 'pledge installment', relationship: 'relationship', note: 'note', control: 'totals', volunteering:'volunteer activity', unsupported: 'unrecognized' } as Record<RowKind, string>)[this.kind()] }
 kind(): RowKind {
  if (['givebutter','zeffy'].includes(this.result.source)&&this.peek('planId')) return 'unsupported'
  // Duration columns also occur in constituent roll-ups; require activity fields.
  if (this.result.source==='lgl' && (this.has('volunteerId')||this.has('volunteerDate')||this.has('volunteerRole'))) return 'volunteering'
  if (this.peek('controlCount') || this.peek('controlAmount')) return 'control'
  if (this.peek('relationshipType') && this.peek('relatedDonor') && !this.peek('giftId')) return 'relationship'
  if ((this.peek('installmentId') || this.peek('dueOn')) && !this.peek('giftId')) return 'installment'
  if (this.peek('softGift') && (this.peek('softDonor') || /soft.?credit/i.test(`${this.table.file} ${this.table.sheet}`))) return 'softCredit'
  const type = normalizeLabel(this.peek('type'))
  if (['individual', 'organization'].includes(type) && !this.peek('giftId') && !this.peek('amount')) return 'donor'
  if (type || this.peek('giftId') || (this.peek('amount') && this.peek('date'))) {
   if (['pledge'].includes(type)) return 'pledge'
   if (['installment', 'pledgeinstallment'].includes(type)) return 'installment'
   if (['softcredit', 'softcredits'].includes(type)) return 'softCredit'
   if (['gift', 'donation', 'cash', 'paycash', 'pledgepayment', 'payment', 'recurringdonationpayment', 'recurringgiftpayment', 'recurringgiftpaycash', 'onetimegift', 'onetime'].includes(type)) return 'gift'
   if(!type&&this.result.spreadsheet?.recordType==='gift')return 'gift'
   // Incumbent exports require explicit types; a spreadsheet has a reviewed record kind.
   return 'unsupported'
  }
  if (this.peek('pledgeId') && this.peek('amount')) return 'pledge'
  if (this.peek('donorId') && (this.peek('name') || this.peek('firstName') || this.peek('lastName') || this.peek('organization'))) return 'donor'
  if (this.peek('donorId') && this.peek('note')) return 'note'
  return 'unsupported'
 }
}
