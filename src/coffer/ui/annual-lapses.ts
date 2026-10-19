import { annualLapses } from '../annual-lapses'
import { person } from '../auth'
import { taskOwners } from '../call-tasks'
import { addDays, type Context } from '../db'
import { box, e, empty, field, form, longDay, money, select } from './common'

export async function annualLapsesPage(c: Context, url: URL) {
 const [report, owners] = await Promise.all([annualLapses(c,url.searchParams.has('year') ? Number(url.searchParams.get('year')) : undefined),taskOwners(c)])
 return `<p><a href="/app/lapses">Call-risk overview</a></p><form method="get" action="/app/lapses"><input type="hidden" name="annual" value="1">${field('Calendar year','year','number',report.year,'required min="1900"')}<button>View annual lists</button></form>
 ${box('Annual giving lists',`<p>${e(report.policy)}</p><p>Through ${e(longDay(report.through))} · ${e(report.timezone)}. Appeal preparation freezes this audience after checking current channel consent.</p>`)}
 ${report.groups.map(group=>box(group.kind.toUpperCase(),`<p>${group.count} donors · ${money(group.amountCents)} reference-year giving</p><p><a href="/app/appeals?annualList=${group.kind}&amp;listYear=${report.year}">Prepare ${group.kind.toUpperCase()} appeal</a></p>
 ${group.rows.length ? `<ul class="list">${group.rows.map(row=>`<li><h3><a href="/app/donors/${e(row.donorId)}">${e(row.name)}</a></h3><p>${e(row.reason)} Reference-year giving: ${money(row.amountCents)}. Last gift: ${e(longDay(row.lastGift)||'Unknown')} · ${money(row.lastGiftCents??0)} remaining.</p>
 ${person(c.actor)&&report.year===Number(report.asOf.slice(0,4)) ? form('task.generate',`${select('Task owner','ownerId',owners.map(o=>[o.id,o.name] as [string,string]),c.actor.id,'required')}${field('Due on','dueOn','date',addDays(report.through,7),'required')}`,'Create follow-up task',{sourceKey:row.sourceKey,donorId:row.donorId}):''}</li>`).join('')}</ul>`:empty('No donors match this annual list.')}`,group.kind)).join('')}`
}
