import { all, event, commit, fail, id, one, type Context, type Row } from '../db'
import { appealCommand, appealDetail } from '../appeals'
import { refreshMessages } from '../communications/outbound'
import { action, AGENT } from './activity'

/** A handoff is not delivery; an uncertain submission is never a safe resend. */
export function outcome(m:Row|null) {
 if (!m) return {state:'not submitted',flagged:true,resend:false}
 if (['bounced','not_sent','rejected','failed'].includes(m.remote_status)) return {state:String(m.remote_status).replaceAll('_',' '),flagged:true,resend:true}
 if (m.remote_status==='delivered') return {state:'delivered',flagged:false,resend:false}
 if (['sent','accepted','handed-off'].includes(m.remote_status)) return {state:'handoff confirmed; delivery unknown',flagged:false,resend:false}
 if (m.status==='rejected') return {state:'submission rejected',flagged:true,resend:true}
 if (m.status==='suppressed') return {state:'suppressed by preferences',flagged:true,resend:false}
 return {state:m.provider==='mango'?'Mango results unavailable':'submission or delivery unknown',flagged:true,resend:false}
}

export async function appealDelivery(c:Context,appealId:string) {
 const detail=await appealDetail(c,appealId)
 const rows=detail.recipients.map(r=>{
  const message=detail.messages.find(m=>m.donor_id===r.donor_id)??null
  return {donorId:r.donor_id,name:r.name,email:r.email,communicationId:message?.id??null,checkedAt:message?.checked_at??null,...outcome(message)}
 })
 const existing=await one(c,`SELECT id,status FROM cf_appeals WHERE json_extract(segment,'$.resendOf')=? AND status<>'discarded' ORDER BY prepared_at DESC,id DESC LIMIT 1`,appealId)
 return {appeal:detail.appeal,rows,results:detail.results,resend:existing,
  reconciled:rows.every(r=>r.checkedAt || r.state==='not submitted'),
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
