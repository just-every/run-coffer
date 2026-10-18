import type { Row } from '../db'
import { interactionItem } from './donor-depth'
import { box, e, empty, longDay, money, when } from './common'

/** One chronological story joins financial facts and staff conversations. */
export function donorTimeline(h: Row, tz: string): string {
 const items: { day: string; order: string; html: string }[] = []
 for (const i of h.depth.interactions) items.push({ day: i.occurred_on, order: i.recorded_at, html: interactionItem(i, tz) })
 for (const n of h.notes ?? []) items.push({ day: n.occurred_on, order: n.recorded_at, html: `<li><strong>Note</strong> · ${longDay(n.occurred_on)}<p>${e(n.body).replace(/\n/g,'<br>')}</p><span class="muted">Imported from ${e(n.source)}</span></li>` })
 for (const g of h.gifts) items.push({ day: g.received_on, order: g.created_at, html: `<li><strong>${g.kind === 'reversal' ? 'Gift reversal' : 'Gift'} · ${money(g.amount_cents)}</strong> · ${longDay(g.received_on)}<p>${e(g.fund)} · ${e(g.method)}${g.appeal ? ` · Appeal: ${e(g.appeal)}` : ''}</p>${g.note ? `<p>${e(g.note)}</p>` : ''}</li>` })
 for (const p of h.pledges) items.push({ day: p.pledged_on, order: p.created_at, html: `<li><strong>Pledge · ${money(p.amount_cents)}</strong> · ${longDay(p.pledged_on)}<p>${money(p.paid_cents)} paid · ${money(p.remaining_cents)} remaining</p></li>` })
 for (const l of h.letters) if (l.delivered_at || l.sent_on || l.printed_at) {
  const day = l.delivered_at ?? l.sent_on ?? l.printed_at
  items.push({ day: day.slice(0,10), order: day, html: `<li><a href="/app/letters/${e(l.batch_id)}">${l.kind === 'statement' ? `${e(l.statement_year)} statement` : 'Gift receipt'}</a> · ${l.delivered_at ? 'Delivered' : l.printed_at ? 'Printed' : 'Sent'} · ${when(day, tz)}</li>` })
 }
 for(const m of h.communications??[])items.push({day:m.created_at.slice(0,10),order:m.created_at,html:`<li><strong>${m.source_kind==='welcome'?'Welcome email':'Appeal email'} · ${e(m.subject)}</strong> · ${e(m.remote_status??m.status)}<p>${e(m.note)}</p></li>`})
 items.sort((a,b) => b.day.localeCompare(a.day) || b.order.localeCompare(a.order))
 return box('Timeline', items.length ? `<ol class="list">${items.map(i=>i.html).join('')}</ol>` : empty('Gifts, pledges and conversations will appear here.'), 'timeline')
}
