import { callTasks, taskOwners, taskSources } from '../call-tasks'
import { today, type Context } from '../db'
import { settings } from '../settings'
import { recurringTasksPanel } from './recurring-tasks'
import { area, box, chip, e, empty, field, form, longDay, money, select, when } from './common'

export async function callTasksPage(c: Context, url: URL) {
 const mine = url.searchParams.get('owner') ?? c.actor.id, state = url.searchParams.get('status') ?? 'active'
 const [tasks, sources, owners, s] = await Promise.all([callTasks(c,mine),taskSources(c),taskOwners(c),settings(c)])
 const allTasks = await callTasks(c), used = new Set(allTasks.map(t=>t.source_key)), available = sources.filter(t=>!used.has(t.key))
 const day = today(s.timezone,new Date(c.now)), options = owners.map(o=>[o.id,o.name] as [string,string])
 const visible = tasks.filter(t=>state==='all'||(state==='done'?t.status==='done':t.status!=='done'))
 const filters = `<form method="get" class="fields">${select('Task owner','owner',[['','All owners'],...options],mine)}${select('Show','status',[['active','Open and snoozed'],['done','Done'],['all','All tasks']],state)}<button>Filter call list</button></form>`
 const list = visible.length ? visible.map(t=>box(t.donor_name, `<p><a href="/app/donors/${e(t.donor_id)}">Open donor timeline</a>${t.phone?` · <a href="tel:${e(t.phone)}">${e(t.phone)}</a>`:' · No phone recorded'}</p><p>${chip(t.status,t.status==='done'?'ok':t.due_on<day?'alarm':'info')} ${money(t.amount_cents)} at risk · ${e(t.owner_name??'Former team member')}${t.owner_status!=='active'?' (reassignment needed)':''} · Due ${longDay(t.due_on)}</p><p>${e(t.reason)}</p>${t.status==='done'?`<p>Call logged ${when(t.completed_at, s.timezone)}. <a href="/app/donors/${e(t.donor_id)}#timeline">Read outcome on donor</a></p>`:
 `<details class="edit"><summary>Assign or change due date</summary>${form('task.assign',`<div class="fields">${select('Owner','ownerId',options,t.owner_id)}${field('Due date','dueOn','date',t.due_on,'required')}</div>`,'Save assignment',{taskId:t.id,version:t.version})}</details>
 <details class="edit"><summary>Snooze</summary>${form('task.snooze',field('Snooze until','dueOn','date','','required'),'Snooze task',{taskId:t.id,version:t.version})}</details>
 <details class="edit"><summary>Log call and finish</summary>${form('task.complete',`${select('Call outcome','outcome',[['connected','Connected'],['voicemail','Left voicemail'],['no_answer','No answer'],['wrong_number','Wrong number']])}${area('Call notes','notes','','required maxlength="8000"')}${area('Next step','nextStep','','maxlength="2000"')}`,'Log call and mark done',{taskId:t.id,version:t.version})}</details>`}`)).join('') : empty('No call tasks match this view.')
 return `<p>Work your calls, record the outcome, and keep the donor’s story current. Snoozed tasks stay here with their new due date.</p>${filters}${list}${box('Create a call from a lapse or pledge',`<p><a href="/app/lapses">See why donors are flagged</a> · <a href="/app/retention">Retention by donor</a> · Amounts are snapshots when a task is created; check the donor before calling.</p>${available.length?form('task.generate',`${select('Donor and reason','sourceKey',available.map(t=>[t.key,`${t.name} · ${t.reason} · ${money(t.amountCents)}`] as [string,string]))}<div class="fields">${select('Owner','ownerId',options,c.actor.id)}${field('Due date','dueOn','date',day,'required')}</div>`,'Create owned task'):empty('Every current lapse and due pledge already has a task, or no follow-up is due.')}`)}${await recurringTasksPanel(c,url,owners,day,state,mine,s.timezone)}`
}
