import type { Bindings } from '../auth.server'
import { donorMailUnavailable, sendDonorMail, DonorMailError } from './outbound-mail'
import { prepareSolicitationRun, solicitationRunGuards } from './solicitation'
import { askFlag, phoneHolds, withTaskRestrictions, completedAsk } from './solicitation-tasks'
import { addDays, all, choice, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, today, type Context, type Row } from './db'
import { requireRole } from './auth'
import { settings } from './settings'
import { lapses } from './lapses'
import { annualLapses } from './annual-lapses'

export const taskOwners = (c: Context) => all(c, "SELECT id,display_name AS name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY display_name,id")
/** Call sources split into those a person can call and those held back, counted under the constituent's status. */
export async function taskCandidates(c: Context, isAsk=true) {
 const day = today((await settings(c)).timezone, new Date(c.now))
 const [flags, annual, installments] = await Promise.all([
  lapses(c),
  annualLapses(c),
  all(c, `SELECT i.id,p.donor_id AS donorId,d.name,i.due_on,p.fund,i.amount_cents-i.paid_cents AS amountCents
   FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
   WHERE i.due_on<=? AND i.paid_cents<i.amount_cents AND d.erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) ORDER BY i.due_on,d.name`, day),
 ])
 const sources = [...flags.rows]
 for (const row of annual.groups.flatMap(g=>g.rows)) if (!sources.some(s=>s.key===row.key)) sources.push(row)
 const candidates = [...sources, ...installments.map(i => ({ key: `pledge:${i.id}`, donorId: i.donorId, name: i.name, kind: 'pledge', amountCents: i.amountCents,
  reason: `Unpaid ${i.fund} pledge installment due ${i.due_on}.`, lastGift: null }))]
 const holds=await phoneHolds(c,candidates.map(s=>s.donorId),isAsk)
 const excluded: Record<string, number> = {}, held = new Map<string, string>(), counted = new Set<string>()
 // Each constituent counts once under their status, however many lapses or pledges would have made a call.
 for (const s of candidates) { const hold=holds.get(s.donorId),why=s.kind==='pledge'&&(hold==='do not solicit'||hold==='solicitation limit')?null:hold; if (why) { held.set(s.key, why); if (!counted.has(s.donorId)) { counted.add(s.donorId); excluded[why] = (excluded[why] ?? 0) + 1 } } }
 return { sources: candidates.filter(s => !held.has(s.key)), excluded, held }
}
export const taskSources = async (c: Context) => (await taskCandidates(c)).sources
export async function callTasks(c: Context, ownerId?: string | null, status?: string | null) {
 const rows=await withTaskRestrictions(c,await all(c, `SELECT t.*,d.name AS donor_name,d.phone,o.display_name AS owner_name,o.status AS owner_status
  FROM cf_call_tasks t JOIN cf_donors d ON d.id=t.donor_id AND d.erased_at IS NULL LEFT JOIN oa_operators o ON o.id=t.owner_id
  WHERE (? IS NULL OR t.status=?) ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END,t.due_on,t.created_at`, status || null, status || null))
 const policy=await taskPolicy(c),day=today((await settings(c)).timezone,new Date(c.now))
 for(const task of rows)task.escalated_to=task.status!=='done'&&businessDue(task.due_on,policy.escalation_days)<day?await escalationOwner(c,task.owner_id):null
 return ownerId?rows.filter(t=>t.owner_id===ownerId||t.escalated_to===ownerId):rows
}
const live = (donorId: string) => guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)', 'DONOR_CHANGED', 'That donor changed. Refresh the call list.', donorId, donorId)
const owner = (ownerId: string) => guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose a current team member.', ownerId)
export async function callTaskCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['task.create','task.policy','task.reminders','task.generate','task.assign','task.snooze','task.complete'].includes(command)) return undefined
 requireRole(c.actor, ['owner','admin','member'], 'manage call tasks')
 if(command==='task.policy'){
  requireRole(c.actor,['owner','admin'],'change task escalation')
  const version=integer(Number(p.version),'Version',1),delay=integer(Number(p.escalationDays),'Business days',1,30)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_task_policy WHERE id=1 AND version=?)','VERSION','Task settings changed.',version),sql('UPDATE cf_task_policy SET escalation_days=?,version=version+1 WHERE id=1',delay),event(c,command,'settings','task-policy',null,{escalationDays:delay})])
  return taskPolicy(c)
 }
 if(command==='task.reminders'){
  const enabled=p.enabled===true||p.enabled==='1'
  await commit(c,[sql('INSERT INTO cf_task_reminder_preferences VALUES(?,?) ON CONFLICT(operator_id) DO UPDATE SET email_enabled=excluded.email_enabled',c.actor.id,enabled?1:0),event(c,command,'operator',c.actor.id,null,{enabled})])
  return {enabled}
 }
 if(command==='task.create'){
  const donorId=id(p.donorId,'Constituent'),ownerId=id(p.ownerId,'Owner'),due=date(p.dueOn,'Due date'),kind=choice(p.kind,['call','meeting','thank_you','follow_up','data_fix'],'task kind'),reason=longText(p.title,'Task title',1000),taskId=newId(),isAsk=askFlag(p,false)
  if(isAsk&&!['call','meeting'].includes(kind))fail('INPUT','Only calls and meetings can be marked as asks.',400)
  const classification=await prepareSolicitationRun(c,{kind:'call-task',id:taskId,channel:'phone',isAsk,donorIds:[donorId]})
  if(classification.excluded.length)fail('SOLICITATION_RESTRICTED',classification.excluded[0].reason)
  const giftId=optional(p.giftId,'Gift'),prospectId=optional(p.prospectId,'Opportunity')
  await commit(c,[live(donorId),owner(ownerId),guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND constituent_status='active')",'DONOR_STATUS','Choose an active constituent.',donorId),...classification.statements,...await solicitationRunGuards(c,'call-task',taskId,[donorId],classification),
   ...(giftId?[guard('EXISTS(SELECT 1 FROM cf_gifts WHERE id=? AND donor_id=?)','LINK_CHANGED','Choose a gift belonging to this constituent.',giftId,donorId)]:[]),...(prospectId?[guard('EXISTS(SELECT 1 FROM cf_prospects WHERE id=? AND donor_id=?)','LINK_CHANGED','Choose an opportunity belonging to this constituent.',prospectId,donorId)]:[]),
   sql("INSERT INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask,task_kind,gift_id,prospect_id) VALUES(?,?,?,'manual',?,0,?,?,?,?,?,?,?)",taskId,donorId,'manual:'+taskId,reason,ownerId,due,c.now,isAsk?1:0,kind,giftId,prospectId),event(c,command,'task',taskId,donorId,{kind,ownerId,dueOn:due})])
  return (await one(c,'SELECT * FROM cf_call_tasks WHERE id=?',taskId))!
 }
 if (command === 'task.generate') {
  const isAsk=askFlag(p), key = id(p.sourceKey, 'Lapse or pledge'), candidates = await taskCandidates(c,isAsk), source = candidates.sources.find(s => s.key === key)
  if (candidates.held.has(key)) fail('DONOR_STATUS', `This constituent is ${candidates.held.get(key)}, so no new call task is created.`)
  if (!source) fail('SOURCE_CHANGED', 'That lapse or pledge no longer needs a call. Refresh the list.')
  const ownerId = id(p.ownerId, 'Owner'), due = date(p.dueOn, 'Due date'), taskId = newId()
  const classification=await prepareSolicitationRun(c,{kind:'call-task',id:taskId,channel:'phone',isAsk:source.kind!=='pledge'&&isAsk,donorIds:[source.donorId]})
  if(classification.excluded.length)fail('SOLICITATION_RESTRICTED',classification.excluded[0].reason)
  await commit(c, [...classification.statements,...await solicitationRunGuards(c,'call-task',taskId,[source.donorId],classification),live(source.donorId), guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND constituent_status='active')", 'DONOR_STATUS', 'This constituent is no longer active, so no new call task is created.', source.donorId), owner(ownerId),
   sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask) VALUES(?,?,?,?,?,?,?,?,?,?)`, taskId, source.donorId, key, source.kind, source.reason, source.amountCents, ownerId, due, c.now,source.kind==='pledge'?0:isAsk?1:0),
   // Only the creator records the event; repeated submissions keep the existing owner and progress.
   sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,?,?,?,'task.generate','task',id,donor_id,'{}' FROM cf_call_tasks WHERE id=?`, c.now,c.actor.id,c.actor.name,c.actor.role,taskId)])
  return (await one(c, 'SELECT * FROM cf_call_tasks WHERE source_key=?', key))!
 }
 const taskId = id(p.taskId, 'Task'), version = integer(p.version, 'Task version', 1)
 const task = await one(c, 'SELECT * FROM cf_call_tasks WHERE id=?', taskId)
 if (!task) fail('NOT_FOUND', 'That task no longer exists.', 404)
 const checks = [live(task.donor_id), guard("EXISTS(SELECT 1 FROM cf_call_tasks WHERE id=? AND version=? AND status<>'done')", 'TASK_CHANGED', 'This task changed or is already done. Refresh before saving.', taskId,version)]
 if (command === 'task.assign') {
  const ownerId = id(p.ownerId,'Owner'), due = date(p.dueOn,'Due date')
  await commit(c,[...checks,owner(ownerId),sql('UPDATE cf_call_tasks SET owner_id=?,due_on=?,version=version+1 WHERE id=?',ownerId,due,taskId),event(c,command,'task',taskId,task.donor_id,{ownerId,dueOn:due})])
 } else if (command === 'task.snooze') {
  const due = date(p.dueOn,'Snooze until'), day = today((await settings(c)).timezone,new Date(c.now))
  if (due<=day) fail('INPUT','Snooze until a future date.',400)
  await commit(c,[...checks,sql("UPDATE cf_call_tasks SET status='snoozed',due_on=?,version=version+1 WHERE id=?",due,taskId),event(c,command,'task',taskId,task.donor_id,{dueOn:due})])
 } else {
  const outcome = ['call','meeting'].includes(task.task_kind)?id(p.outcome,'Call outcome'):'connected'
  if (!['connected','voicemail','no_answer','wrong_number'].includes(outcome)) fail('INPUT','Choose the call outcome.',400)
  const notes = longText(p.notes,'Call notes'), nextStep = optional(p.nextStep,'Next step',2000)
  const conversation=['call','meeting'].includes(task.task_kind),interactionId = conversation?newId():null, day = today((await settings(c)).timezone,new Date(c.now))
  await commit(c,[...checks,...(conversation?await completedAsk(c,task,p):[]),
   ...(conversation?[sql("INSERT INTO cf_interactions(id,donor_id,kind,occurred_on,who,notes,next_step,recorded_at,recorded_by,recorded_by_id,meaningful) SELECT ?,d.id,?,?,?,?,?,?,?,?,? FROM cf_donors d WHERE d.id=?",interactionId,task.task_kind,day,c.actor.name,`${outcome.replaceAll('_',' ')}: ${notes}`,nextStep,c.now,c.actor.name,c.actor.id,outcome==='connected'?1:0,task.donor_id)]:[]),
   sql("UPDATE cf_call_tasks SET status='done',completed_at=?,interaction_id=?,completion_notes=?,version=version+1 WHERE id=?",c.now,interactionId,notes,taskId),event(c,command,'task',taskId,task.donor_id,{outcome,interactionId})])
 }
 return (await one(c,'SELECT * FROM cf_call_tasks WHERE id=?',taskId))!
}


export const taskPolicy=(c:Context)=>one(c,'SELECT * FROM cf_task_policy WHERE id=1').then(r=>r!)
/** Weekends do not consume escalation delay; escalation begins after the final business day. */
export function businessDue(due:string,delay:number){
 let day=due,left=delay
 while(left>0){day=addDays(day,1);const weekday=new Date(day+'T12:00:00Z').getUTCDay();if(weekday!==0&&weekday!==6)left--}
 return day
}
export async function escalationOwner(c:Context,operatorId:string){
 return (await one(c,`SELECT o.id FROM cf_task_team t JOIN oa_operators o ON o.id=t.manager_id WHERE t.operator_id=? AND o.status='active' AND o.role IN ('owner','admin','member')`,operatorId))?.id??(await one(c,"SELECT id FROM oa_operators WHERE status='active' AND role='owner' ORDER BY id LIMIT 1"))?.id??null
}
export async function taskNotices(c:Context,operatorId=c.actor.id){
 return all(c,`SELECT n.*,t.reason,t.due_on,t.donor_id,t.status AS task_status FROM cf_task_notices n JOIN cf_call_tasks t ON t.id=n.task_id JOIN cf_donors d ON d.id=t.donor_id WHERE n.recipient_id=? AND d.erased_at IS NULL ORDER BY n.day DESC,n.id`,operatorId)
}
/** Durable daily notices share the same current assignment and business-day calculation as the daily list. */
export async function runTaskReminders(env:Bindings,at:Date){
 const c:Context={db:env.DB,env,now:at.toISOString(),actor:{id:'coffer-scheduler',name:'Task scheduler',role:'owner'},authority:{sql:'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)',params:[]}}
 const s=await settings(c),day=today(s.timezone,at),tasks=await callTasks(c)
 for(const task of tasks.filter(t=>t.status!=='done'&&t.due_on<=addDays(day,1))){
  const targets=[{id:task.owner_id,kind:'reminder'},...(task.escalated_to&&task.escalated_to!==task.owner_id?[{id:task.escalated_to,kind:'escalation'}]:[])]
  for(const target of targets){
   await commit(c,[sql(`INSERT OR IGNORE INTO cf_task_notices(id,task_id,task_version,recipient_id,day,kind) SELECT ?,t.id,t.version,o.id,?,? FROM cf_call_tasks t JOIN oa_operators o ON o.id=? AND o.status='active' WHERE t.id=? AND t.version=? AND t.status<>'done'`,newId(),day,target.kind,target.id,task.id,task.version)])
  }
 }
 if(donorMailUnavailable(env))return
 await commit(c,[sql("UPDATE cf_task_notices SET status='uncertain' WHERE status='sending' AND attempted_at<=?",new Date(at.getTime()-15*60000).toISOString())])
 const pending=await all(c,`SELECT n.*,o.email FROM cf_task_notices n JOIN oa_operators o ON o.id=n.recipient_id AND o.status='active' JOIN cf_task_reminder_preferences p ON p.operator_id=o.id AND p.email_enabled=1 JOIN cf_call_tasks t ON t.id=n.task_id AND t.version=n.task_version AND t.status<>'done' JOIN cf_donors d ON d.id=t.donor_id AND d.erased_at IS NULL AND d.constituent_status='active' WHERE n.day=? AND n.status='pending' LIMIT 40`,day)
 for(const notice of pending){
  const current=(await callTasks(c,notice.recipient_id)).find(t=>t.id===notice.task_id&&t.version===notice.task_version&&t.status!=='done')
  if(!current)continue
  const claimed=await env.DB.prepare("UPDATE cf_task_notices SET status='sending',attempted_at=? WHERE id=? AND status='pending'").bind(c.now,notice.id).run()
  if(!claimed.meta.changes)continue
  let status='uncertain',messageId:string|null=null
  try{const result=await sendDonorMail(env,{deliveryId:notice.id,from:env.MAIL_FROM!,to:[notice.email],subject:notice.kind==='escalation'?'Overdue task needs your attention':'Your daily task reminder',text:`${notice.kind==='escalation'?'An assigned task is overdue past the escalation delay.':'You have a task due tomorrow or earlier.'} Open your private daily list: ${env.AUTH_ORIGIN}/app/calls`});messageId=result.providerMessageId;status=messageId?'submitted':'uncertain'}
  catch(error){if(error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome))status='rejected'}
  await commit(c,[sql("UPDATE cf_task_notices SET status=?,message_id=? WHERE id=? AND status='sending'",status,messageId,notice.id),event(c,'task.reminder','task',notice.task_id,current.donor_id,{recipientId:notice.recipient_id,kind:notice.kind,state:status})])
 }
}
