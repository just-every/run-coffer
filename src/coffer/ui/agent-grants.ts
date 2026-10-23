import { agentGrantsState, GRANT_PERMISSIONS } from '../agent-grants'
import type { Context, Row } from '../db'
import { area, box, e, field, form, select } from './common'

function grantForm(g:Row|undefined,state:Awaited<ReturnType<typeof agentGrantsState>>) {
 const permissions=g?JSON.parse(g.permissions):['donors.list','donors.context','ack.prepare']
 return form('agentGrant.save',field('Grant name','name','text',g?.name??'','required maxlength="100"')+
  area('Explicit donor identifiers (one per line or comma separated)','donorIds',g?JSON.parse(g.donor_ids).join('\n'):'','required')+
  '<fieldset><legend>Allowed actions</legend>'+GRANT_PERMISSIONS.map(p=>`<label><input type="checkbox" name="permissions" value="${e(p)}"${permissions.includes(p)?' checked':''}> ${e(p)}</label>`).join('')+'</fieldset>'+
  field('Daily receipt limit','dailyLimit','number',g?.daily_limit??10,'required min="1" max="1000"')+
  select('Grant status','enabled',[['yes','Enabled'],['no','Disabled']],g?.enabled===0?'no':'yes')+
  `<label><input type="checkbox" name="standingApproval" value="yes"> I approve standing standard-receipt sending with settings revision ${e(state.settingsVersion)} and thank-you template revision ${e(state.templateRevision)}. This remains subject to the daily limit and kill switch.</label>`,
  g?'Save revised grant':'Create named grant',g?{id:g.id,version:g.version}:{})
}
/** The Data & access page can append this panel for owner/admin actors. */
export async function agentGrantsPanel(c:Context) {
 const state=await agentGrantsState(c),control=state.control!
 return box('Named agent grants',`<p>Choose specific donors and actions. Preparation keys have a named all-record read-and-prepare grant with daily limits until you explicitly attach a scoped grant. Attaching a grant replaces that access. Disabled grants stay restricted.</p>
 <p>Scoped context contains direct donor facts only. Named receipt preparation takes at most eight explicit gifts from active individual donors without household, relationship or soft-credit dependencies. Broader preparation needs a person.</p>
 ${form('agentGrant.kill',`<p>All agent keys are ${control.enabled?'enabled':'stopped'}.</p>`,control.enabled?'Stop all agent keys':'Enable agent keys',{version:control.version,enabled:control.enabled?'no':'yes'})}
 <h3>Preparation grants</h3><p>These grants retain existing all-record reads and acknowledgment/appeal preparation, with zero sending permission. Request limits include MCP discovery and refused requests. Attach an explicit grant to narrow record scope.</p>
 ${state.preparationGrants.filter(g=>state.keys.some(k=>k.id===g.key_id&&!k.grant_id&&!k.revoked_at)).map(g=>`<article><h4>${e(g.name)}</h4>${form('agentGrant.legacyLimits',field('Daily request limit','readLimit','number',g.read_limit,'required min="1" max="1000000"')+field('Daily preparation limit','prepareLimit','number',g.prepare_limit,'required min="1" max="10000"')+select('Status','enabled',[['yes','Enabled'],['no','Disabled']],g.enabled?'yes':'no'),'Save preparation limits',{id:g.id,version:g.version})}</article>`).join('')}
 <details><summary>Create a grant</summary>${grantForm(undefined,state)}</details>
 ${state.grants.map(g=>`<article><h3>${e(g.name)}</h3><p>Revision ${e(g.version)} · ${g.enabled?'Enabled':'Disabled'}</p><details><summary>Review or narrow grant</summary>${grantForm(g,state)}</details>${g.enabled?form('agentGrant.disable','','Stop this grant',{id:g.id,version:g.version}):''}</article>`).join('')}
 ${state.grants.some(g=>g.enabled)&&state.keys.some(k=>!k.revoked_at)?form('agentGrant.attach',select('Agent key','keyId',state.keys.filter(k=>!k.revoked_at).map(k=>[k.id,k.label]))+select('Named grant','grantId',state.grants.filter(g=>g.enabled).map(g=>[g.id,g.name])),'Attach grant'):''}
 <p>Daily limits count reserved letters, including provider rejection or interruption; they reset on the organization’s calendar day. Interrupted dispatches need a person to investigate before any further sending. A template change requires a fresh standing approval.</p>`,'agent-grants')
}
