import { journeySendGuards } from './journey-guards'
import type { Bindings } from '../../auth.server'
import { all, commit, event, guard, newId, one, sql, today, type Context, type Row } from '../db'
import { prepareSolicitationRun, solicitationReason, solicitationRunGuards } from '../solicitation'
import { settings } from '../settings'
import { communicationReasons } from './preference-rules'
import { journeyCap } from './journey-cap'
import { enrollJourneys, enrollmentReason, journeyConsent, journeyLive, stopEnrollment } from './journey-triggers'
import { journeyMessage } from './welcome'
import { submitMessage } from './outbound'

const order=`CASE step WHEN 'thank' THEN 0 WHEN 'impact' THEN 1 ELSE 2 END`
async function settle(c:Context,id:string,claim:string,status:string,note:string){
 await c.db.batch([
  c.db.prepare("UPDATE cf_journey_steps SET status=?,note=? WHERE id=? AND status='uncertain' AND note=?").bind(status,note,id,claim),
  c.db.prepare("DELETE FROM cf_journey_slots WHERE step_id=? AND EXISTS(SELECT 1 FROM cf_journey_steps WHERE id=? AND status='pending' AND note=?)").bind(id,id,note),
 ])
}
export async function runJourneys(c:Context):Promise<Row>{
 await enrollJourneys(c)
 const active=await all(c,"SELECT e.* FROM cf_journey_enrollments e WHERE e.status='active' ORDER BY e.enrolled_at,e.id")
 for(const e of active){const j=(await one(c,'SELECT * FROM cf_journeys WHERE id=?',e.journey_id))!,reason=await enrollmentReason(c,e,j);if(reason)await stopEnrollment(c,e.id,reason)}
 const due=await all(c,`SELECT s.*,e.journey_id,e.gift_id AS first_gift_id,t.kind,t.is_ask,t.condition,v.subject,v.body,v.list_name,j.owner_id
 FROM cf_journey_steps s JOIN cf_journey_enrollments e ON e.id=s.enrollment_id JOIN cf_journeys j ON j.id=e.journey_id
 JOIN cf_journey_templates t ON t.journey_id=j.id AND t.step=s.step JOIN cf_journey_step_publications v ON v.code=t.code
 WHERE s.status='pending' AND e.status='active' AND julianday(s.due_at)<=julianday(?)
 ORDER BY COALESCE(s.checked_at,''),julianday(s.due_at),CASE s.step WHEN 'thank' THEN 0 WHEN 'impact' THEN 1 ELSE 2 END,s.id LIMIT 24`,c.now)
 let submitted=0,uncertain=0,cancelled=0,held=0,tasks=0,waited=0
 for(const s of due){
  await commit(c,[sql("UPDATE cf_journey_steps SET checked_at=? WHERE id=? AND status='pending'",c.now,s.id)])
  if(await one(c,`SELECT 1 FROM cf_journey_steps WHERE enrollment_id=? AND status IN ('pending','uncertain') AND ${order}<?`,s.enrollment_id,s.step==='thank'?0:s.step==='impact'?1:2))continue
  const e=(await one(c,'SELECT * FROM cf_journey_enrollments WHERE id=?',s.enrollment_id))!,j=(await one(c,'SELECT * FROM cf_journeys WHERE id=?',s.journey_id))!
  const reason=await enrollmentReason(c,e,j);if(reason){await stopEnrollment(c,e.id,reason);cancelled++;continue}
  const reply=await one(c,`SELECT 1 FROM cf_reply_tasks r JOIN cf_communications m ON m.id=r.communication_id JOIN cf_journey_steps prior ON prior.message_key=m.message_key WHERE prior.enrollment_id=? AND r.received_at>=? AND r.status<>'filed'`,s.enrollment_id,e.enrolled_at)
  if(s.condition!=='always'&&(s.condition==='replied')!==!!reply){await commit(c,[sql("UPDATE cf_journey_steps SET status='skipped',note='Reply branch did not match.' WHERE id=? AND status='pending'",s.id),event(c,'journey.branch','journey_step',s.id,s.donor_id,{condition:s.condition,replied:!!reply})]);continue}
  const channel=s.kind==='task'?'phone':'email',preference=s.is_ask?(await communicationReasons(c,[s.donor_id],channel)).get(s.donor_id):null
  const restricted=s.is_ask?await solicitationReason(c,s.donor_id,channel,c.now):null
  if(restricted||preference){const note=restricted?.reason??preference!;await commit(c,[sql("UPDATE cf_journey_steps SET status='skipped',note=? WHERE id=? AND status='pending'",note,s.id),event(c,'journey.askSkipped','journey_step',s.id,s.donor_id,{reason:note})]);cancelled++;continue}
  if(s.kind==='wait'){await commit(c,[sql("UPDATE cf_journey_steps SET status='completed',note='Wait finished.' WHERE id=? AND status='pending'",s.id)]);waited++;continue}
  if(s.kind==='task'){
   const rendered=await journeyMessage(c,s),blanks:string[]=JSON.parse(rendered.merge_blanks)
   if(blanks.length){await commit(c,[sql("UPDATE cf_journey_steps SET merge_blanks=?,note=? WHERE id=? AND status='pending'",JSON.stringify(blanks),'Missing merge fields: '+blanks.join(', '),s.id)]);held++;continue}
   const taskId='journey:'+s.id,day=today((await settings(c)).timezone,new Date(c.now))
   const classification=await prepareSolicitationRun(c,{kind:'call-task',id:taskId,channel:'phone',isAsk:!!s.is_ask,donorIds:[s.donor_id]})
   await commit(c,[...classification.statements,...await solicitationRunGuards(c,'call-task',taskId,[s.donor_id],classification),...await journeySendGuards(c,s.id),guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",'TASK_OWNER','The published task owner is unavailable. Stop this journey and publish with a current owner.',s.owner_id),sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,status,version,created_at,is_ask) SELECT ?,?,?,'journey',?,COALESCE((SELECT net_cents FROM cf_gift_balances WHERE id=?),0),?,?,'open',1,?,? WHERE EXISTS(SELECT 1 FROM cf_journey_steps WHERE id=? AND status='pending')`,taskId,s.donor_id,taskId,rendered.subject+'\n\n'+rendered.body,s.first_gift_id,s.owner_id,day,c.now,s.is_ask,s.id),sql("UPDATE cf_journey_steps SET status='completed',note='Created an owned call task; no donor contact made.' WHERE id=? AND status='pending'",s.id),event(c,'journey.task','journey_step',s.id,s.donor_id,{taskId,ownerId:s.owner_id})]);tasks++;continue
  }
  const cap=await journeyCap(c,s.donor_id,s.id)
  if(!cap.allowed){await commit(c,[sql("UPDATE cf_journey_steps SET note='Journey frequency cap; still pending.' WHERE id=? AND status='pending'",s.id)]);held++;continue}
  const rendered=await journeyMessage(c,s),blanks:string[]=JSON.parse(rendered.merge_blanks)
  if(!rendered.recipient.email&&!blanks.includes('email'))blanks.push('email')
  if(blanks.length){await commit(c,[sql("UPDATE cf_journey_steps SET merge_blanks=?,note=? WHERE id=? AND status='pending'",JSON.stringify(blanks),'Missing merge fields: '+blanks.join(', '),s.id)]);held++;continue}
  const classification=await prepareSolicitationRun(c,{kind:'welcome',id:s.id,channel:'email',isAsk:!!s.is_ask,donorIds:[s.donor_id]})
  const claim='Submission claim '+newId()+'. No automatic retry.'
  await commit(c,[...classification.statements,sql(`UPDATE cf_journey_steps SET status='uncertain',note=?,claimed_at=?,merge_blanks='[]' WHERE id=? AND status='pending' AND ${cap.condition}
   AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.version=? AND ${journeyLive} AND ${journeyConsent})`,claim,c.now,s.id,...cap.params!,s.donor_id,rendered.version),sql(`INSERT INTO cf_journey_slots SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM cf_journey_steps WHERE id=? AND status='uncertain' AND note=?) ON CONFLICT(step_id) DO UPDATE SET reserved_on=excluded.reserved_on`,s.id,s.donor_id,today((await settings(c)).timezone,new Date(c.now)),s.id,claim)])
  if(!await one(c,"SELECT id FROM cf_journey_steps WHERE id=? AND status='uncertain' AND note=?",s.id,claim))continue
  const finalReason=await enrollmentReason(c,e,j)
  if(finalReason){await settle(c,s.id,claim,'cancelled',finalReason);await stopEnrollment(c,e.id,finalReason);cancelled++;continue}
  try{
   const result=await submitMessage(c,{key:s.message_key,donorId:s.donor_id,sourceKind:'welcome',sourceId:s.id,subject:s.subject,body:s.body,listName:s.list_name,rendered,expectedEmail:rendered.recipient.email,expectedContactId:rendered.recipient.selected_email_contact_id,expectedContactVersion:rendered.recipient.selected_email_contact_version})
   const status=['submitted','listed'].includes(result.status)?'submitted':result.status==='suppressed'||result.status==='rejected'?'cancelled':'uncertain'
   await settle(c,s.id,claim,status,status==='submitted'?'Submitted; delivery is not confirmed.':status==='cancelled'?'Provider refused or suppressed this message.':'Submission uncertain; no automatic retry.')
   if(status==='submitted')submitted++;else if(status==='uncertain')uncertain++;else cancelled++
  }catch(error){
   const message=await one(c,'SELECT id FROM cf_communications WHERE message_key=?',s.message_key)
   await settle(c,s.id,claim,message?'uncertain':'pending',message?'Submission uncertain; no automatic retry.':'Provider submission did not begin. Check the connection.')
   throw error
  }
 }
 await commit(c,[sql(`UPDATE cf_journey_enrollments SET status='completed',stopped_at=? WHERE status='active' AND NOT EXISTS(SELECT 1 FROM cf_journey_steps s WHERE s.enrollment_id=cf_journey_enrollments.id AND s.status IN ('pending','uncertain'))`,c.now)])
 return {submitted,uncertain,cancelled,held,tasks,waited}
}
export function runScheduledJourneys(env:Bindings,at:Date){return runJourneys({db:env.DB,env,now:at.toISOString(),actor:{id:'coffer-scheduler',name:'Journey scheduler',role:'owner'},authority:{sql:'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)',params:[]}})}
