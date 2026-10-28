import { manager } from '../auth'
import { all, newId, type Context, type Row } from '../db'
import { area, box, chip, e, empty, field, form, select, when } from '../ui/common'
import { mailboxState } from './connection'

const title=(provider:string)=>provider==='gmail'?'Gmail':'Microsoft 365'
const confirmation='<label><input type="checkbox" name="confirm" value="yes" required> I approve this personal mailbox action</label>'
export function mailboxSettingsLink(c:Context) {
 return manager(c.actor)?box('Personal mailboxes','<p><a href="/app/settings/mailboxes">Connect and manage my mailboxes</a></p>'):''
}
export async function mailboxSettingsPage(c:Context) {
 const rows=await mailboxState(c)
 return '<div class="cf-mailbox"><p><a href="/app/settings">Settings</a></p>'+rows.map(row=>box(title(row.provider),`
  ${row.connected?`<p>${chip('Connected','ok')} ${e(row.account)}</p>${form('mailbox.sync','', 'Log recent messages',{provider:row.provider})}${row.bcc?`<details><summary>Log mail from another client</summary><p>Send from this connected mailbox and BCC <code>${e(row.bcc)}</code>. Only mail to one uniquely matched constituent is logged.</p></details>`:'<p>Set COFFER_REPLY_DOMAIN to enable authenticated BCC logging.</p>'}${form('mailbox.disconnect','', 'Disconnect my '+title(row.provider),{provider:row.provider})}`:row.configured?`<p>Connect the personal mailbox matching your Coffer sign-in address.</p>${form('mailbox.start',confirmation,'Connect my '+title(row.provider),{provider:row.provider})}`:'<p>Configure the provider application, then connect your own mailbox.</p>'}
  <details><summary>${title(row.provider)} application</summary><p>Redirect address: <code>${e(row.callback)}</code></p>${form('mailbox.configure',field('Client ID','clientId','text','','required autocomplete="off"')+field('Client secret','clientSecret','password','','required autocomplete="new-password"')+confirmation,'Configure '+title(row.provider),{provider:row.provider})}</details>
 `)).join('')+'</div>'
}
export function mailboxSyncPage(result:Row,input:Row) {
 const outcomes=result.outcomes as Row[]
 return box('Mailbox logging',`<p role="status">${outcomes.filter(r=>r.logged).length} messages logged.</p>${outcomes.length?`<ul class="list">${outcomes.map(r=>`<li>${r.donorId?`<a href="/app/donors/${e(r.donorId)}#timeline">View constituent timeline</a>`:e(r.reason)}${r.id&&!r.logged?' · Already logged':''}</li>`).join('')}</ul>`:empty('No recent messages to log.')}${result.next?form('mailbox.sync','', 'Log next page',{provider:input.provider,cursor:result.next}):''}<p><a href="/app/settings/mailboxes">Back to my mailboxes</a></p>`)
}
export async function personalMailPanel(c:Context,donor:Row) {
 if(!manager(c.actor))return ''
 const connections=(await mailboxState(c)).filter(r=>r.connected)
 const drafts=await all(c,"SELECT * FROM cf_mailbox_messages WHERE donor_id=? AND operator_id=? AND state IN('draft','sending','uncertain','submitted') ORDER BY recorded_at DESC,rowid DESC LIMIT 10",donor.id,c.actor.id)
 const compose=connections.length?form('mailbox.prepare',select('Send from my mailbox','provider',connections.map(row=>[row.provider,title(row.provider)+' · '+row.account] as [string,string]))+select('Message purpose','purpose',[['appeals','Appeal or other ask'],['newsletter','Personal non-ask or newsletter']])+field('Subject','subject','text','','required maxlength="400"')+area('Personal message','body','','required maxlength="4000"'),'Review personal email',{donorId:donor.id,requestId:newId()}):'<p><a href="/app/settings/mailboxes">Connect my personal mailbox</a></p>'
 return '<div class="cf-mailbox">'+box('Personal email',`<details><summary>Write a personal email</summary>${compose}</details>${drafts.map(row=>`<article><h3>${e(row.subject)}</h3><p>${chip(row.state,row.state==='uncertain'?'alarm':'info')} · ${e(row.note)}</p><details${row.state==='draft'?' open':''}><summary>Review saved message</summary><p class="pre">${e(row.excerpt)}</p></details>${row.state==='draft'?form('mailbox.submit',confirmation,'Submit this personal email',{messageId:row.id,donorId:donor.id}):''}</article>`).join('')}`,'personal-email')+'</div>'
}
