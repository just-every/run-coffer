import { all, event, commit, fail, id, one, type Context, type Row } from '../db'
import { appealCommand, appealDetail } from '../appeals'
import { refreshMessages } from '../communications/outbound'
import { action, AGENT } from './activity'

/** A handoff is not delivery; an uncertain submission is never a safe resend. */
export function outcome(m:Row|null) {
 if (!m) return {state:'unknown',reason:'No saved submission result. Continue the original approved send; no separate resend.',flagged:true,resend:false}
 if (m.status==='suppressed'||['suppressed','unsubscribe','unsubscribed','complaint'].includes(m.remote_status)) return {state:'not sent',reason:'Suppressed by preferences; consent evidence never qualifies for a resend.',flagged:true,resend:false}
 if (m.remote_status==='bounced') return {state:'bounced',reason:'Provider-reported final bounce.',flagged:true,resend:true}
 if (m.remote_status==='not_sent'||m.status==='rejected') return {state:'not sent',reason:m.note??'The provider confirmed this message was not sent.',flagged:true,resend:true}
 if (m.remote_status==='delivered') return {state:'delivered',reason:'The provider reports acceptance by the recipient’s mail server, not proof of reading.',flagged:false,resend:false}
 if (m.remote_status==='sent') return {state:'sent',reason:'The provider reports sending to this recipient; delivery is unconfirmed.',flagged:false,resend:false}
 if (['accepted','handed-off'].includes(m.remote_status)||!m.remote_status&&(m.status==='submitted'||m.provider==='mango'&&m.status==='listed')) return {state:'handed off',reason:m.provider==='mango'?'On the Mango list, awaiting the Mango operator. Mango’s events API lacks campaign-bound sender results; delivery remains unknown.':'The provider accepted the request; sending and delivery remain unconfirmed.',flagged:false,resend:false}
 return {state:'unknown',reason:m.provider==='mango'?'Mango’s events API lacks campaign-bound sender results. Unknown results are held.':'No bound final result. Deferred or uncertain results are held for provider review.',flagged:true,resend:false}
}

export async function appealDelivery(c:Context,appealId:string) {
 const detail=await appealDetail(c,appealId)
 const rows=detail.recipients.map(r=>{
  const message=detail.messages.find(m=>m.donor_id===r.donor_id)??null
  return {donorId:r.donor_id,name:r.name,email:r.email,communicationId:message?.id??null,checkedAt:message?.checked_at??null,...outcome(message)}
 })
 const existing=await one(c,`SELECT id,status FROM cf_appeals WHERE json_extract(segment,'$.resendOf')=? AND status<>'discarded' ORDER BY prepared_at DESC,id DESC LIMIT 1`,appealId)
 return {appeal:detail.appeal,rows,results:detail.results,resend:existing,
  reconciled:rows.every(r=>r.checkedAt || !r.communicationId || r.state==='handed off'),
  unknown:rows.filter(r=>r.state==='unknown').length,
  deliveryUnknown:rows.filter(r=>!['delivered','bounced','not sent'].includes(r.state)).length,
  deliveryComplete:rows.length>0&&rows.every(r=>r.state==='delivered'),flagged:rows.filter(r=>r.flagged).length}
}

export async function deliveryState(c:Context) {
 const appeals=await all(c,`SELECT a.id,a.name,a.status,a.recipients FROM cf_appeals a
 WHERE a.channel='email' AND a.status IN ('approved','exported','sent') ORDER BY a.prepared_at DESC,a.id DESC LIMIT 100`)
 const { journeyDelivery }=await import('./journey-delivery')
 return {appeals,journey:await journeyDelivery(c)}
}

export async function reconcileAppeal(c:Context,p:Row) {
 const appealId=id(p.appealId,'Appeal'),detail=await appealDetail(c,appealId)
 if(detail.appeal.channel!=='email'||!['approved','exported','sent'].includes(detail.appeal.status))fail('NOT_APPROVED','Choose an approved email appeal.',409)
 const refresh=await refreshMessages(c,{kind:'appeal',id:appealId})
 const result=await appealDelivery(c,appealId)
 await action(c,{kind:'appeals.reconcile',subjectId:appealId,summary:`Checked ${refresh.checked} sender results; ${result.flagged} recipients need review.`,why:'Compared the frozen audience with saved sender outcomes and signed response-code ledger entries. Handoff and unknown results do not confirm delivery.'})
 return {...result,checked:refresh.checked}
}

export async function prepareResend(c:Context,p:Row) {
 const appealId=id(p.appealId,'Appeal'),state=await appealDelivery(c,appealId)
 if(state.appeal.channel!=='email'||!['approved','exported','sent'].includes(state.appeal.status))fail('NOT_APPROVED','Choose an approved email appeal.',409)
 if(state.resend)return {id:state.resend.id,status:state.resend.status,existing:true}
 const donorIds=state.rows.filter(r=>r.resend).map(r=>r.donorId)
 if(!donorIds.length)fail('NO_RESEND','No confirmed unsent or bounced recipients are available. Review uncertain outcomes with the provider.',409)
 const message=await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId)
 if(!message)fail('NO_MESSAGE','This appeal has no saved message to prepare.',409)
 const prepared=await appealCommand({...c,actor:{...AGENT}},'appeal.prepare',{
  name:`Resend · ${state.appeal.name}`.slice(0,200),channel:'email',subject:message.subject,body:message.body,
 },{donorIds,resendOf:appealId})
 await commit(c,[event(c,'agent.appeals.resend','appeal',prepared!.id,null,{originalAppealId:appealId,eligible:donorIds.length})])
 return {...prepared,status:'prepared'}
}
