import type { Row } from '../db'
import { e, longDay, money, when } from './common'

export function inKindLedgerRow(g:Row,live=true) {
 const title=g.kind==='in_kind_correction'?'Property correction':'Noncash property'
 return `<tr><td class="lead">${longDay(g.received_on)}</td><td data-label="Amount">${title}<br>No monetary contribution<br>Donor-stated internal value: ${money(g.stated_value_cents)}</td><td data-label="Fund · paid by">${e(g.fund)}<p>${e(g.property_description)} · Quantity ${e(g.quantity)}</p></td><td data-label="Letter">${live?`<a href="#in-kind-${e(g.property_id)}">Property acknowledgments</a>`:'Anonymous property record'}</td></tr>`
}
export function inKindTimelineItem(g:Row,timezone:string) {
 return `<li><strong>${g.kind==='in_kind_correction'?'Property correction recorded':'Property contribution'}</strong> · ${g.kind==='in_kind_correction'?when(g.created_at,timezone):longDay(g.received_on)}<p>${e(g.property_description)} · Quantity ${e(g.quantity)}</p><p>Donor-stated internal value: ${money(g.stated_value_cents)}. No monetary contribution.</p></li>`
}
