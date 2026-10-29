import type { Actor } from '../auth'
import type { Context, Row } from '../db'
import { teamAccessState, type ReadResource } from '../team-access'
import { box, e, form, money, page, select, shortDate } from './common'

export async function teamAccessPage(c:Context) {
 const state=await teamAccessState(c)
 return box('Member access',`<p>Read-only members can view ordinary records and nonconfidential timelines. They cannot change records, use files, export data or contact providers. Native account roles stay unchanged.</p>
  ${state.people.length?state.people.map(p=>box(p.name,form('team.access',
   select('Coffer access','readOnly',[['0','Native member access'],['1','Read-only']],String(p.read_only)),
   'Save member access',{operatorId:p.id,operatorVersion:p.operator_version,version:p.version}))).join(''):'<p>No active native members.</p>'}`)
}
const labels:Record<ReadResource,string>={donors:'Constituents',gifts:'Gifts',pledges:'Pledges',tasks:'Tasks',opportunities:'Opportunities',interactions:'Timeline'}
const fieldNames:Record<string,string>={email:'Email',phone:'Phone',address_line1:'Street address',address_line2:'Address line 2',city:'City',region:'State or region',postal_code:'Postal code',country:'Country',constituent_status:'Constituent status',received_on:'Gift date',amount_cents:'Amount',method:'Payment method',fund:'Fund',kind:'Ledger entry',due_by:'Pledge due',pledged_on:'Pledged on',due_on:'Due date',status:'Task status',owner_name:'Assigned to',stage:'Stage',ask_amount_cents:'Ask amount',expected_close_on:'Expected close',next_step:'Next step'}
export async function readOnlyPage(actor:Actor,resource:ReadResource,result:Row,path:string) {
 const rows=result.data instanceof Array?result.data:[result.data]
 const links=(['donors','gifts','pledges','tasks','opportunities'] as const).map(r=>`<a href="/app/${r}">${labels[r]}</a>`).join(' · ')
 const content=rows.map((r:Row)=>`<li><strong><a href="/app/${resource}/${encodeURIComponent(r.id)}">${e(r.name??r.label??r.reason??r.donor_name)}</a></strong>
  ${resource!=='donors'&&r.donor_id?`<p><a href="/app/donors/${encodeURIComponent(r.donor_id)}">${e(r.donor_name)}</a></p>`:''}
  ${Object.entries(r).filter(([k])=>Object.hasOwn(fieldNames,k)).map(([k,v])=>`<div>${fieldNames[k]}: ${e(k.endsWith('_cents')?money(Number(v)):k.endsWith('_on')||k==='due_by'?shortDate(v):v??'—')}</div>`).join('')}</li>`).join('')
 const timeline=result.timeline?`<section class="card" id="timeline"><h2>Nonconfidential timeline</h2><ul class="list">${result.timeline.map((r:Row)=>`<li>${e(r.occurred_on)} · ${e(r.kind)}<p>${e(r.body)}</p></li>`).join('')}</ul></section>`:''
 return page(labels[resource],`<p role="status">Read-only access</p><p>${links}</p>${box(labels[resource],`<ul class="list">${content||'<li>No current records.</li>'}</ul>`)}${timeline}${result.page?.next?`<p><a href="?after=${encodeURIComponent(result.page.next)}">Next page</a></p>`:''}`,actor,200,path)
}
