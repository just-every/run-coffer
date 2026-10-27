import { all, commit, event, fail, id, one, type Context, type Row } from '../db'
import { appealCommand } from '../appeals'
import { refreshMessages } from '../communications/outbound'
import { AGENT, action } from './activity'
import { outcome } from './appeals'
import { journeyResults } from './journey-results'

const source = `FROM (SELECT id,step,response_code,donor_id,status,message_key,due_at FROM cf_welcome_steps UNION ALL SELECT id,step,response_code,donor_id,status,message_key,due_at FROM cf_journey_steps) s JOIN cf_donors d ON d.id=s.donor_id
 LEFT JOIN cf_communications m ON m.message_key=s.message_key
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges x WHERE x.donor_id=d.id)
 AND s.status IN ('submitted','uncertain')`

async function proposal(c:Context,stepId:string) {
 return one(c,`SELECT id,status FROM cf_appeals WHERE json_extract(segment,'$.resendOf')=?
 AND status<>'discarded' ORDER BY prepared_at DESC,id DESC LIMIT 1`,stepId)
}

export async function journeyDelivery(c:Context) {
 const steps=await all(c,`SELECT s.id,s.step,s.response_code,s.donor_id,d.name,s.status,m.id AS communication_id,m.provider,
 m.status AS message_status,m.remote_status,m.checked_at ${source} ORDER BY s.due_at DESC,s.id LIMIT 100`)
 const totals = new Map<string, ReturnType<typeof journeyResults>>()
 return Promise.all(steps.map(s=>{
  const key=s.response_code??''
  if(!totals.has(key))totals.set(key,journeyResults(c,s.response_code))
  return result(c,s,totals.get(key))
 }))
}

async function result(c:Context,s:Row,totals=journeyResults(c,s.response_code)) {
 const responses=await totals
 return {id:s.id,step:s.step,donor_id:s.donor_id,name:s.name,checked_at:s.checked_at,
  ...outcome(s.communication_id?{...s,status:s.message_status}:null),resendProposal:await proposal(c,s.id),
  responses}
}

async function submittedStep(c:Context,p:Row) {
 const stepId=id(p.stepId,'Journey step')
 const step=await one(c,`SELECT s.*,d.name,m.id AS communication_id,m.status AS message_status,m.provider,
 m.remote_status,m.checked_at,m.subject,m.body ${source} AND s.id=?`,stepId)
 if(!step?.communication_id)fail('NOT_SUBMITTED','Choose a submitted journey message.',409)
 return step
}

export async function reconcileJourney(c:Context,p:Row) {
 const step=await submittedStep(c,p)
 const refresh=await refreshMessages(c,{kind:'welcome',id:step.id})
 const checked=await result(c,await submittedStep(c,p))
 await action(c,{kind:'appeals.journey.reconcile',subjectId:step.id,
  summary:`Checked ${refresh.checked} journey sender results.`,why:'Compared the saved message and its frozen destination with sender results. Handoff is not delivery; gift responses bind only through the published step code.'})
 return {...checked,checked:refresh.checked}
}

export async function prepareJourneyResend(c:Context,p:Row) {
 const step=await submittedStep(c,p),existing=await proposal(c,step.id)
 if(existing)return {...existing,existing:true}
 if(!outcome({...step,status:step.message_status}).resend)fail('NO_RESEND','No confirmed unsent or bounced journey message is available. Check sender results first.',409)
 const prepared=await appealCommand({...c,actor:{...AGENT}},'appeal.prepare',{
  name:`Journey resend · ${step.name} · ${step.step}`.slice(0,200),channel:'email',subject:step.subject,body:step.body,
 },{donorIds:[step.donor_id],resendOf:step.id})
 await commit(c,[event(c,'agent.appeals.journey.resend','appeal',prepared!.id,step.donor_id,{stepId:step.id,communicationId:step.communication_id})])
 return {...prepared,status:'prepared'}
}
