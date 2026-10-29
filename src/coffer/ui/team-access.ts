import type { Actor } from '../auth'
import type { Context, Row } from '../db'
import { teamAccessState, type ReadResource } from '../team-access'
import { box, e, form, money, page, select } from './common'

export async function teamAccessPage(c:Context) {
 const state=await teamAccessState(c)
 return box('Member access',`<p>Read-only members can view ordinary records and nonconfidential timelines. They cannot change records, use files, export data or contact providers. Native account roles stay unchanged.</p>
  ${state.people.length?state.people.map(p=>box(p.name,form('team.access',
   select('Coffer access','readOnly',[['0','Native member access'],['1','Read-only']],String(p.read_only)),
   'Save member access',{operatorId:p.id,operatorVersion:p.operator_version,version:p.version}))).join(''):'<p>No active native members.</p>'}`)
}
const labels:Record<ReadResource,string>={donors:'Constituents',gifts:'Gifts',pledges:'Pledges',tasks:'Tasks',opportunities:'Opportunities',interactions:'Timeline'}
export async function readOnlyPage(actor:Actor,resource:ReadResource,result:Row,path:string) {
 const rows=result.data instanceof Array?result.data:[result.data]
 const links=(['donors','gifts','pledges','tasks','opportunities'] as const).map(r=>`<a href="/app/${r}">${labels[r]}</a>`).join(' · ')
 const content=rows.map((r:Row)=>`<li><strong>${resource==='donors'?`<a href="/app/donors/${encodeURIComponent(r.id)}">${e(r.name)}</a>`:e(r.label??r.reason??r.donor_name)}</strong>
  ${resource!=='donors'&&r.donor_id?`<p><a href="/app/donors/${encodeURIComponent(r.donor_id)}">${e(r.donor_name)}</a></p>`:''}
  ${Object.entries(r).filter(([k])=>!['id','name','label','reason','donor_name','version'].includes(k)).map(([k,v])=>`<div>${e(k.replaceAll('_',' '))}: ${e(k.endsWith('_cents')?money(Number(v)):v??'—')}</div>`).join('')}</li>`).join('')
 const timeline=result.timeline?`<section class="card" id="timeline"><h2>Nonconfidential timeline</h2><ul class="list">${result.timeline.map((r:Row)=>`<li>${e(r.occurred_on)} · ${e(r.kind)}<p>${e(r.body)}</p></li>`).join('')}</ul></section>`:''
 return page(labels[resource],`<p role="status">Read-only access</p><p>${links}</p>${box(labels[resource],`<ul class="list">${content||'<li>No current records.</li>'}</ul>`)}${timeline}${result.page?.next?`<p><a href="?after=${encodeURIComponent(result.page.next)}">Next page</a></p>`:''}`,actor,200,path)
}
