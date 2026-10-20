import type { Context, Row } from '../db'
import { tributeNotifications } from '../tribute-notifications'
import { tributeGroups, tributeKey } from '../tribute-groups'
import { box,e,form,money } from './common'

export async function tributePanel(c:Context,donorId:string,tributes:Row[],staff:boolean,boss:boolean) {
 if(!tributes.length)return ''
 const groups=await tributeGroups(c),notifications=await tributeNotifications(c,donorId)
 return box('Tributes and family notifications',`<ul class="list">${tributes.map(t=>{
  const group=groups.find(g=>g.key===tributeKey(t.kind,t.honoree))
  const prepared=notifications.filter(n=>n.gift_id===t.gift_id)
  return `<li><strong>In ${t.kind==='memory'?'memory':'honor'} of ${e(t.honoree)}</strong><p>${money(group?.totalCents??0)} remaining across ${group?.giftIds.length??0} gifts in this name. Grouping does not merge people.</p>${t.source_group?`<p>Imported tribute group: ${e(t.source_group)}</p>`:''}<p>Family notification amount: ${t.amount_permission?'Allowed by the donor at checkout':'Withheld; no donor permission recorded'}</p>${staff&&t.notified_name&&(t.notified_email||t.notified_address)?form('tributeNotification.prepare','','Prepare family notification',{giftId:t.gift_id,returnDonorId:donorId}):'<p>No family notification contact recorded.</p>'}${prepared.map(n=>`<article><h3>${n.status==='approved'?'Approved':'Prepared'} family notification · version ${n.version}</h3><p>Not sent. Staff download or print this reviewed copy; Coffer does not contact the family.</p><p>${e(n.recipient_name)}${n.recipient_email?' · '+e(n.recipient_email):''}${n.recipient_address?' · '+e(n.recipient_address):''}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%">${e(n.body)}</pre>${boss&&n.status==='prepared'?form('tributeNotification.approve','','Approve family notification',{notificationId:n.id,version:n.version,returnDonorId:donorId}):''}${boss&&n.status==='approved'?`<p><a href="/api/coffer/tribute-notifications/${e(n.id)}/download">Download approved email text</a> · <a href="/app/tribute-notifications/${e(n.id)}/print">Print approved family letter</a></p>`:''}</article>`).join('')}</li>`
 }).join('')}</ul>`,'tribute-notifications')
}
