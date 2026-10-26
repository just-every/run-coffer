import { type Context, type Row } from '../db'
import { area, box, chip, e, field, hidden, select } from '../ui/common'
import { hygieneState } from './hygiene'

const post=(action:string,content:string,label:string,values:Row={})=>`<form method="post" action="/app/agent/hygiene/${action}">${Object.entries(values).map(([k,v])=>hidden(k,v)).join('')}${content}<button>${e(label)}</button></form>`
const label=(kind:string)=>({merge:'Merge duplicate records',address:'Update postal address',status:'Review constituent status',salutation:'Add missing salutation'} as Row)[kind]
function change(p:Row) {
 const v=p.input
 if(p.kind==='merge')return `<p>Merge <strong>${e(p.related_name)}</strong> into <strong>${e(p.donor_name)}</strong>. The surviving contact details remain selected; both histories are retained.</p><p><a href="/app/duplicates/compare?target=${e(p.donor_id)}&amp;source=${e(p.related_donor_id)}">Compare donor records</a></p>`
 if(p.kind==='address')return `<p>Proposed address: <strong>${e([v.addressLine1,v.addressLine2,v.city,v.region,v.postalCode,v.country].filter(Boolean).join(', '))}</strong>. Effective ${e(v.addressEffectiveOn)}.</p>`
 if(p.kind==='status')return `<p>Proposed status: <strong>${e(v.constituentStatus)}</strong>${v.deceasedOn?' · Recorded date of death '+e(v.deceasedOn):''}. Existing status rules will close current outreach when accepted.</p>`
 return `<p>Proposed informal salutation: <strong>${e(v.informalSalutation)}</strong>.</p>`
}
export async function hygienePage(c:Context) {
 const state=await hygieneState(c),pending=state.proposals.filter(p=>p.status==='pending'),history=state.proposals.filter(p=>p.status!=='pending')
 const card=(p:Row)=>box(`${p.donor_name} · ${label(p.kind)}`,`<p>${chip(p.status,p.status==='pending'?'warn':'')} · <a href="/app/donors/${e(p.donor_id)}">Open donor record</a></p>${change(p)}<details><summary>Evidence for this proposal</summary><p>${e(p.evidence)}</p></details>${p.status==='pending'?post('review','<label><input type="checkbox" name="confirm" value="ACCEPT" required> I reviewed the evidence and accept this exact change.</label>','Accept change',{id:p.id,decision:'accept'})+post('review','','Reject proposal',{id:p.id,decision:'reject'}):''}`)
 return `<p>Review duplicates, returned mail, forwarded notices and missing salutations. Running the agent prepares proposals; your donor records change only after you accept.</p>
 ${box('Check the database',post('run','','Find hygiene proposals'))}
 ${pending.length?pending.map(card).join(''):'<p>No pending hygiene proposals.</p>'}
 <details><summary>Record forwarded evidence</summary>${box('Evidence and proposed correction',post('evidence',
 select('Donor','donorId',state.donors.map(d=>[d.id,d.name]),'','required')+
 select('Evidence source','source',[['returned_mail','Returned letter'],['ncoa','NCOA result'],['family_note','Forwarded family note'],['obituary','Forwarded obituary']])+
 area('Evidence and source reference','evidence','','required maxlength="2000" rows="3"')+
 select('Proposed correction','kind',[['status','Constituent status'],['address','Postal address']])+
 `<details><summary>Status correction</summary>${select('Proposed status','constituentStatus',[['inactive','Inactive'],['deceased','Deceased']])}${field('Date of death (required for deceased)','deceasedOn','date')}</details>`+
 `<details><summary>Address correction</summary>${field('Address line 1','addressLine1')}${field('Address line 2','addressLine2')}${field('City','city')}${field('State or region','region')}${field('Postal code','postalCode')}${field('Country','country','text','United States')}${field('Address effective date','addressEffectiveOn','date')}</details>`+
 '<p>Record the correction explicitly supported by the source. Returned mail cannot establish a death. No source is fetched or shared externally.</p>','Record evidence'))}</details>
 ${history.length?`<details><summary>Reviewed and stale proposals (${history.length})</summary>${history.map(card).join('')}</details>`:''}`
}
