import { inKindTimelineItem } from './in-kind-ledger'
import { timelineFilter,TIMELINE_KINDS } from '../timeline'
import { today, type Row } from '../db'
import { interactionItem } from './donor-depth'
import { box, e, empty, field,select,longDay, money, when } from './common'

/** One chronological story joins financial facts and staff conversations. */
export function donorTimeline(h: Row, timezone: string,url?:URL): string {
 const items: { kind:string; day: string; order: string; html: string }[] = []
 for (const i of h.depth.interactions) items.push({ kind:i.kind,day: i.occurred_on, order: i.recorded_at, html: interactionItem(i, timezone) })
 for(const v of h.volunteering?.rows??[])items.push({kind:'volunteering',day:v.occurred_on,order:v.recorded_at,html:`<li><strong>Volunteering · ${e(v.role)}</strong> · ${longDay(v.occurred_on)}<p>${e(v.hours)} hours · ${e(v.source)}</p></li>`})
 for (const n of h.notes ?? []) items.push({ kind:n.kind,day: n.occurred_on, order: n.recorded_at, html: `<li><strong>${n.confidential?'Confidential ':''}${n.kind==='visit'?'Visit':'Note'}</strong> · ${longDay(n.occurred_on)}<p>${e(n.body).replace(/\n/g,'<br>')}</p><span class="muted">${n.source==='Coffer'?'Recorded by '+e(n.recorded_by):'Imported from '+e(n.source)}</span></li>` })
 for (const g of h.gifts) items.push({ kind:'gift',day: g.kind==='in_kind_correction'?today(timezone,new Date(g.created_at)):g.received_on, order: g.created_at, html: g.source==='in_kind'?inKindTimelineItem(g,timezone):`<li><strong>${g.kind === 'reversal' ? 'Gift reversal' : 'Gift'} · ${money(g.amount_cents)}</strong> · ${longDay(g.received_on)}<p>${e(g.fund)} · ${e(g.method)}${g.appeal ? ` · Appeal: ${e(g.appeal)}` : ''}</p>${g.note ? `<p>${e(g.note)}</p>` : ''}</li>` })
 for (const p of h.pledges) items.push({ kind:'pledge',day: p.pledged_on, order: p.created_at, html: `<li><strong>Pledge · ${money(p.amount_cents)}</strong> · ${longDay(p.pledged_on)}<p>${money(p.paid_cents)} paid · ${money(p.remaining_cents)} remaining</p></li>` })
 for (const l of h.letters) if (l.delivered_at || l.sent_on || l.printed_at) {
  const day = l.delivered_at ?? l.sent_on ?? l.printed_at
  items.push({ kind:'receipt',day: day.length === 10 ? day : today(timezone,new Date(day)), order: day, html: `<li><a href="/app/letters/${e(l.batch_id)}">${l.kind === 'statement' ? `${e(l.statement_year)} statement` : 'Gift receipt'}</a> · ${l.delivered_at ? 'Delivered' : l.printed_at ? 'Printed' : 'Sent'} · ${when(day, timezone)}</li>` })
 }
 for(const m of h.communications??[])items.push({kind:'email',day:today(timezone,new Date(m.created_at)),order:m.created_at,html:`<li><strong>${m.source_kind==='welcome'?'Welcome email':'Appeal email'} · ${e(m.subject)}</strong> · ${e(m.remote_status??m.status)}<p>${e(m.note)}</p></li>`})
 for(const t of h.timelineSources??[]){const day=t.kind!=='appeal'&&t.at?.includes('T')?today(timezone,new Date(t.at)):t.day;items.push({kind:t.kind,day,order:t.at,html:`<li><strong>${e(t.title)}</strong> · ${longDay(day)}<p>${e(t.body)}</p></li>`})}
 const filter=timelineFilter(url),shown=items.filter(i=>(!filter.kind||i.kind===filter.kind)&&(!filter.from||i.day>=filter.from)&&(!filter.to||i.day<=filter.to))
 const controls=`<form method="get" action="/app/donors/${e(h.donor.id)}#timeline" class="fields">${select('Timeline type','timelineKind',[['','All activity'],...TIMELINE_KINDS.map(k=>[k,k[0].toUpperCase()+k.slice(1)] as [string,string])],filter.kind)}${field('Timeline from','timelineFrom','date',filter.from)}${field('Timeline to','timelineTo','date',filter.to)}<button>Filter timeline</button></form>`
 shown.sort((a,b) => b.day.localeCompare(a.day) || b.order.localeCompare(a.order))
 return box('Timeline', controls+(shown.length ? `<ol class="list">${shown.map(i=>i.html.replace('<li>',`<li data-timeline-kind="${e(i.kind)}">`)).join('')}</ol>` : empty('No activity matches these timeline filters.')), 'timeline')
}
