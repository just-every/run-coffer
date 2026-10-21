import { prepareSolicitationRun, solicitationRunGuards } from './solicitation'
import { askFlag, phoneHolds, withTaskRestrictions, completedAsk } from './solicitation-tasks'
import { all, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, today, type Context, type Row } from './db'
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
 return withTaskRestrictions(c,await all(c, `SELECT t.*,d.name AS donor_name,d.phone,o.display_name AS owner_name,o.status AS owner_status
  FROM cf_call_tasks t JOIN cf_donors d ON d.id=t.donor_id AND d.erased_at IS NULL LEFT JOIN oa_operators o ON o.id=t.owner_id
  WHERE (? IS NULL OR t.owner_id=?) AND (? IS NULL OR t.status=?) ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END,t.due_on,t.created_at`, ownerId || null, ownerId || null, status || null, status || null))
}
const live = (donorId: string) => guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)', 'DONOR_CHANGED', 'That donor changed. Refresh the call list.', donorId, donorId)
const owner = (ownerId: string) => guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose a current team member.', ownerId)
export async function callTaskCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['task.generate','task.assign','task.snooze','task.complete'].includes(command)) return undefined
 requireRole(c.actor, ['owner','admin','member'], 'manage call tasks')
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
  const outcome = id(p.outcome,'Call outcome')
  if (!['connected','voicemail','no_answer','wrong_number'].includes(outcome)) fail('INPUT','Choose the call outcome.',400)
  const notes = longText(p.notes,'Call notes'), nextStep = optional(p.nextStep,'Next step',2000)
  const interactionId = newId(), day = today((await settings(c)).timezone,new Date(c.now))
  await commit(c,[...checks,...await completedAsk(c,task,p),
   sql("INSERT INTO cf_interactions(id,donor_id,kind,occurred_on,who,notes,next_step,recorded_at,recorded_by,recorded_by_id,meaningful) SELECT ?,d.id,'call',?,?,?, ?,?,?,?,? FROM cf_donors d WHERE d.id=?",interactionId,day,c.actor.name,`${outcome.replaceAll('_',' ')}: ${notes}`,nextStep,c.now,c.actor.name,c.actor.id,outcome==='connected'?1:0,task.donor_id),
   sql("UPDATE cf_call_tasks SET status='done',completed_at=?,interaction_id=?,version=version+1 WHERE id=?",c.now,interactionId,taskId),event(c,command,'task',taskId,task.donor_id,{outcome,interactionId})])
 }
 return (await one(c,'SELECT * FROM cf_call_tasks WHERE id=?',taskId))!
}
