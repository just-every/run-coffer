import { acknowledgmentFilterFields } from './acknowledgment-filters'
import { report } from '../custom-report'
import type { Context } from '../db'
import { exactUsd } from '../money'
import { box, e, empty, field, longDay, select } from './common'

export async function customReportPage(c: Context, url: URL) {
 const data = await report(c, url)
 const filters = `<form method="get" action="/app/reports/custom-fields"><div class="fields">${select('Gift custom field', 'field', data.fields.map(f => [f.key, f.label] as [string, string]), data.field?.key ?? '', 'required')}${field('From', 'from', 'date', data.from)}${field('Through', 'through', 'date', data.through)}${acknowledgmentFilterFields(url)}</div><button>Show report</button></form>`
 if (!data.field) return box('Gifts by custom field', `${empty('Define a gift custom field to use it as a report column and grouping.')}<p><a href="/app/settings#custom-field-definitions">Define custom fields</a></p>`)
 const selected = data.field
 const valueLabel = (value: unknown, display: string) => value === null ? '<span class="muted">Not set</span>' : e(display)
 const query = new URLSearchParams(url.searchParams)
 query.set('field',selected.key)
 if (data.from) query.set('from', data.from)
 if (data.through) query.set('through', data.through)
 const groupedRows = data.groups.map(g => `<tr><td class="lead">${valueLabel(g.value, g.displayValue)}</td><td data-label="Gifts">${g.giftCount}</td><td data-label="Contribution">${e(exactUsd(String(g.amountCents)))}</td></tr>`).join('')
 const groups = groupedRows ? `<div class="scroll"><table class="stack"><thead><tr><th>${e(selected.label)}</th><th>Gifts</th><th>Contribution</th></tr></thead><tbody>${groupedRows}</tbody><tfoot><tr><th>Total</th><td data-label="Gifts">${data.giftCount}</td><td data-label="Contribution">${e(exactUsd(String(data.totalCents)))}</td></tr></tfoot></table></div>` : empty('No gifts or ledger adjustments match this period.')
 const entryRows = data.records.map(r => `<tr><td class="lead"><a href="/app/donors/${e(r.donorId)}">${e(r.donorName)}</a><br>${longDay(r.receivedOn)}</td><td data-label="${e(selected.label)}">${valueLabel(r.value, r.displayValue)}</td><td data-label="Contribution">${e(exactUsd(String(r.amountCents)))}</td><td data-label="Entry">${e(r.kind)}<br><small>${e(r.id)}</small>${r.id !== r.originalId ? `<br><small>Original gift: ${e(r.originalId)}</small>` : ''}</td></tr>`).join('')
 const entries = entryRows ? `<div class="scroll"><table class="stack"><thead><tr><th>Donor · date</th><th>${e(selected.label)}</th><th>Contribution</th><th>Entry</th></tr></thead><tbody>${entryRows}</tbody></table></div>` : empty('No ledger entries in this period.')
 return `${box('Gifts by custom field', `${filters}<p>Group and show the current value of <strong>${e(selected.label)}</strong> (<code>${e(selected.key)}</code>). Dates include gifts and adjustments received on each selected day. Leave dates blank for all records.</p><p>Reversals and processor adjustments use the original gift’s custom value. Each original gift counts once, including when only its reversal falls in the period. Pick-many combinations form a single group. Property gifts contribute zero monetary cents; their stated values are separate.</p>`)}${box('Grouped contributions', `${groups}<p><a href="/app/reports/custom-fields.csv?${e(query.toString())}">Download private report (CSV)</a></p>`)}${box('All matching ledger entries', entries)}`
}
