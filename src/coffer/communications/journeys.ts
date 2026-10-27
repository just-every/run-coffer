import { requireRole } from '../auth'
import { all, choice, commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row } from '../db'
import { amount } from '../money'
import { journeyLinks } from '../agent/journey-results'
import { journeyContent } from './welcome'
import { runJourneys } from './journey-runner'

export const JOURNEY_TRIGGERS=['gift_amount','lapse','lybunt','sybunt','recurring','anniversary','event','saved_list'] as const
export const JOURNEY_STEPS=['thank','impact','ask'] as const
export async function journeyCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['journey.publish','journey.run','journey.stop','journey.cap'].includes(command))return
 requireRole(c.actor,['owner','admin'],'publish and run journeys')
 if(command==='journey.run')return runJourneys(c)
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Explicitly approve this journey change.',400)
 if(command==='journey.cap'){
  const capDays=integer(Number(p.capDays),'Days between journey emails',1,365)
  await commit(c,[sql('UPDATE cf_journey_policy SET cap_days=? WHERE id=1',capDays),event(c,command,'journey','cap',null,{capDays})]);return {capDays}
 }
 if(command==='journey.stop'){
  const journeyId=id(p.journeyId,'Journey')
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_journeys WHERE id=? AND stopped_at IS NULL)','JOURNEY_CHANGED','Choose an active journey.',journeyId),sql('UPDATE cf_journeys SET stopped_at=? WHERE id=?',c.now,journeyId),sql("UPDATE cf_journey_enrollments SET status='stopped',stopped_at=? WHERE journey_id=? AND status='active'",c.now,journeyId),sql("UPDATE cf_journey_steps SET status='cancelled',note='A person stopped this journey.' WHERE status='pending' AND enrollment_id IN(SELECT id FROM cf_journey_enrollments WHERE journey_id=?)",journeyId),event(c,command,'journey',journeyId,null,{confirmed:true})]);return {id:journeyId,stopped:true}
 }
 const name=text(p.name,'Journey name'),trigger=choice(p.trigger,JOURNEY_TRIGGERS,'journey trigger'),journeyId=newId()
 const amountCents=trigger==='gift_amount'?amount(p,'amount','Gift threshold'):null
 const listId=trigger==='saved_list'?id(p.listId,'Saved list'):null,eventId=trigger==='event'?id(p.eventId,'Event'):null
 if(listId&&!await one(c,'SELECT id FROM cf_saved_lists WHERE id=?',listId))fail('NOT_FOUND','Choose a current saved list.',404)
 if(eventId&&!await one(c,'SELECT id FROM cf_fundraising_events WHERE id=?',eventId))fail('NOT_FOUND','Choose a current event.',404)
 const ownerId=p.ownerId?id(p.ownerId,'Task owner'):c.actor.id
 if(!await one(c,"SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member')",ownerId))fail('TASK_OWNER','Choose an active team member.',400)
 const impactDays=integer(Number(p.impactDays),'Second-step delay',1,365),askDays=integer(Number(p.askDays),'Third-step delay',impactDays+1,730)
 const steps=[]
 for(const step of JOURNEY_STEPS){
  const kind=choice(p[step+'Kind']??'email',['email','task','wait'],'step kind'),condition=choice(p[step+'Condition']??'always',['always','replied','not_replied'],'reply branch')
  const isAsk=choice(p[step+'IsAsk']??(step==='ask'?'yes':'no'),['yes','no'],'ask classification')==='yes'
  const subject=await journeyContent(c,p[step+'Subject'],step+' subject'),raw=await journeyContent(c,p[step+'Body'],step+' message',true)
  const code=`JOURNEY-${journeyId}-${step}`,body=journeyLinks(raw,code,c.env!.AUTH_ORIGIN)
  steps.push({step,kind,condition,isAsk,subject,body,code,delay:step==='thank'?0:step==='impact'?impactDays:askDays})
 }
 await commit(c,[sql('INSERT INTO cf_journeys(id,name,trigger,amount_cents,list_id,event_id,owner_id,published_at,published_by) VALUES(?,?,?,?,?,?,?,?,?)',journeyId,name,trigger,amountCents,listId,eventId,ownerId,c.now,c.actor.id),...steps.flatMap(s=>[
  sql("INSERT INTO cf_appeal_codes(code,name,origin,created_at) VALUES(?,?,'staff',?)",s.code,name+' · '+s.step,c.now),
  sql('INSERT INTO cf_journey_step_publications(code,publication_id,step,subject,body,list_name,published_at) VALUES(?,?,?,?,?,?,?)',s.code,journeyId,s.step,s.subject,s.body,'Coffer journey · '+journeyId+' · '+s.step,c.now),
  sql('INSERT INTO cf_journey_templates VALUES(?,?,?,?,?,?,?)',journeyId,s.step,s.code,s.kind,s.isAsk?1:0,s.condition,s.delay),
 ]),event(c,command,'journey',journeyId,null,{trigger,amountCents,listId,eventId,explicitConsent:true,codes:steps.map(s=>s.code)})])
 return {id:journeyId,published:true,steps}
}
export async function journeyState(c:Context):Promise<Row>{
 requireRole(c.actor,['owner','admin'],'read journey membership and messages')
 const [journeys,templates,enrollments,steps,policy,mergeReview]=await Promise.all([
  all(c,'SELECT * FROM cf_journeys ORDER BY published_at DESC,id'),
  all(c,'SELECT t.*,v.subject,v.body FROM cf_journey_templates t JOIN cf_journey_step_publications v ON v.code=t.code ORDER BY t.delay_days'),
  all(c,`SELECT e.*,d.name,j.name AS journey_name FROM cf_journey_enrollments e JOIN cf_donors d ON d.id=e.donor_id JOIN cf_journeys j ON j.id=e.journey_id WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) ORDER BY e.enrolled_at DESC,e.id LIMIT 100`),
  all(c,'SELECT * FROM cf_journey_steps ORDER BY due_at,id'),one(c,'SELECT cap_days FROM cf_journey_policy WHERE id=1'),all(c,`SELECT s.id,s.donor_id,s.merge_blanks,d.name,j.name AS journey_name FROM cf_journey_steps s JOIN cf_donors d ON d.id=s.donor_id JOIN cf_journey_enrollments e ON e.id=s.enrollment_id JOIN cf_journeys j ON j.id=e.journey_id WHERE s.status='pending' AND s.merge_blanks<>'[]' AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) ORDER BY lower(d.name),s.id`)])
 return {mergeReview:mergeReview.map(r=>({...r,fields:JSON.parse(r.merge_blanks)})),capDays:policy!.cap_days,journeys:journeys.map(j=>({...j,steps:templates.filter(t=>t.journey_id===j.id)})),enrollments:enrollments.map(e=>({...e,steps:steps.filter(s=>s.enrollment_id===e.id)}))}
}
