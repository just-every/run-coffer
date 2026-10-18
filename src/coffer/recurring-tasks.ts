import { requireRole } from './auth'
import { all, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'
import type { Bindings } from '../auth.server'

const query = `SELECT t.*,s.title,s.donor_id,s.owner_id,s.interval_months,s.anchor_day,d.name AS donor_name,o.display_name AS owner_name
 FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id
 LEFT JOIN cf_donors d ON d.id=s.donor_id LEFT JOIN oa_operators o ON o.id=s.owner_id`
const live = (donorId: string | null) => guard(`? IS NULL OR EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'DONOR_CHANGED', 'Choose a current donor record.', donorId, donorId)

export async function recurringTasks(c: Context, ownerId?: string | null) {
 requireRole(c.actor, ['owner','admin','member'], 'read repeating tasks')
 return all(c, query+' WHERE (? IS NULL OR s.owner_id=?) ORDER BY t.due_on,t.id', ownerId || null, ownerId || null)
}

/** Keep the original day of the month after shorter months: Jan 31 → Feb 28
 * → Mar 31, rather than permanently moving the series to the 28th. */
function nextDue(task: Row): string {
 const [year,month] = String(task.due_on).split('-').map(Number)
 const target = new Date(Date.UTC(year, month-1+task.interval_months, 1))
 const last = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
 target.setUTCDate(Math.min(task.anchor_day,last))
 return target.toISOString().slice(0,10)
}
function successor(c: Context, task: Row): Stmt[] {
 const taskId=newId(), due=nextDue(task)
 return [
  sql(`INSERT OR IGNORE INTO cf_recurring_tasks(id,series_id,previous_id,due_on,created_at)
   SELECT ?,series_id,id,?,? FROM cf_recurring_tasks WHERE id=?`, taskId,due,c.now,task.id),
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,?,?,?,'task.repeatNext','task',t.id,s.donor_id,? FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE t.id=?`,
   c.now,c.actor.id,c.actor.name,c.actor.role,JSON.stringify({previousId:task.id,dueOn:due}),taskId),
 ]
}

export async function recurringTaskCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['task.repeatCreate','task.repeatComplete'].includes(command)) return undefined
 requireRole(c.actor, ['owner','admin','member'], 'manage repeating tasks')
 if (command==='task.repeatCreate') {
  const title=text(p.title,'Task title',200), ownerId=id(p.ownerId,'Owner'), due=date(p.dueOn,'First due date')
  const months=integer(p.intervalMonths,'Repeat interval',1,3), donorId=optional(p.donorId,'Donor',100)
  if (![1,3].includes(months)) fail('INPUT','Choose monthly or quarterly.',400)
  const seriesId=newId(), taskId=newId()
  await commit(c,[live(donorId),guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",'OWNER_CHANGED','Choose a current team member.',ownerId),
   sql('INSERT INTO cf_recurring_task_series(id,donor_id,title,owner_id,interval_months,anchor_day,created_at) VALUES(?,?,?,?,?,?,?)',seriesId,donorId,title,ownerId,months,Number(due.slice(8)),c.now),
   sql('INSERT INTO cf_recurring_tasks(id,series_id,due_on,created_at) VALUES(?,?,?,?)',taskId,seriesId,due,c.now),
   event(c,command,'task',taskId,donorId,{seriesId,intervalMonths:months,dueOn:due})])
  return (await one(c,query+' WHERE t.id=?',taskId))!
 }
 const taskId=id(p.taskId,'Task'), version=integer(p.version,'Task version',1), notes=longText(p.notes,'Completion notes',8000)
 const task=await one(c,query+' WHERE t.id=?',taskId)
 if (!task) fail('NOT_FOUND','That repeating task no longer exists.',404)
 await commit(c,[live(task.donor_id),guard("EXISTS(SELECT 1 FROM cf_recurring_tasks WHERE id=? AND version=? AND status='open')",'TASK_CHANGED','This task changed or is already complete. Refresh before saving.',taskId,version),
  sql("UPDATE cf_recurring_tasks SET status='done',version=version+1,completed_at=?,completed_by=?,notes=? WHERE id=?",c.now,c.actor.name,notes,taskId),
  event(c,command,'task',taskId,task.donor_id,{seriesId:task.series_id}),...successor(c,task)])
 return (await one(c,query+' WHERE t.id=?',taskId))!
}

/** Called by the installed minute Cron. The unique predecessor and due date
 * make completion and concurrent/replayed ticks converge on one next task. */
export async function advanceRecurringTasks(env: Bindings, at: Date) {
 const c:Context={db:env.DB,env,now:at.toISOString(),actor:{id:'coffer-scheduler',name:'Repeating task scheduler',role:'owner'},authority:{sql:'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)',params:[]}}
 const day=today((await settings(c)).timezone,at)
 const due=await all(c,query+` WHERE t.due_on<? AND NOT EXISTS(SELECT 1 FROM cf_recurring_tasks n WHERE n.previous_id=t.id) ORDER BY t.due_on,t.id LIMIT 100`,day)
 for (const task of due) await commit(c,[live(task.donor_id),...successor(c,task)])
 return {advanced:due.length}
}
