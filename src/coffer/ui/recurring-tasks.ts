import { one, type Context, type Row } from '../db'
import { recurringTasks } from '../recurring-tasks'
import { area, box, chip, e, empty, field, form, longDay, select, when } from './common'

export async function recurringTasksPanel(c: Context, url: URL, owners: Row[], day: string, state: string, mine: string, timezone: string) {
 const donorId = url.searchParams.get('repeatDonor')
 const [tasks, donor] = await Promise.all([
  recurringTasks(c, mine),
  donorId ? one(c, `SELECT id,name FROM cf_donors WHERE id=? AND erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)`, donorId) : Promise.resolve(null),
 ])
 const visible = tasks.filter(t => state === 'all' || (state === 'done' ? t.status === 'done' : t.status !== 'done'))
 const options = owners.map(o => [o.id, o.name] as [string, string])
 const general = new URL(url)
 general.searchParams.delete('repeatDonor')
 general.hash = 'repeating-tasks'
 const list = visible.length ? `<ul class="list">${visible.map(t => {
  const next = tasks.find(n => n.series_id === t.series_id && n.previous_id === t.id)
  return `<li><h3>${e(t.title)}</h3><p>${chip(t.status === 'done' ? 'Done' : 'Open', t.status === 'done' ? 'ok' : t.due_on < day ? 'alarm' : 'info')} ${t.interval_months === 3 ? 'Quarterly' : 'Monthly'} · ${e(t.owner_name ?? 'Former team member')} · Due ${longDay(t.due_on)}</p>
   <p>${t.donor_id && t.donor_name ? `<a href="/app/donors/${e(t.donor_id)}">${e(t.donor_name)}</a>` : 'General team task'}</p>
   <p>${next ? `Next due ${longDay(next.due_on)}` : 'Next occurrence is created when this task is completed or its due date passes.'}</p>
   ${t.status === 'done' ? `<p>Completed ${when(t.completed_at, timezone)}</p>${t.notes ? `<p>${e(t.notes)}</p>` : ''}` : `<details class="edit"><summary>Complete task</summary>${form('task.repeatComplete', area('Completion notes', 'notes', '', 'required maxlength="8000"'), 'Complete task', { taskId: t.id, version: t.version })}</details>`}</li>`
 }).join('')}</ul>` : empty('No repeating tasks match this view.')
 const create = `<details class="edit"${donor ? ' open' : ''}><summary>Create a repeating task</summary>
  <p>${donor ? `For <a href="/app/donors/${e(donor.id)}">${e(donor.name)}</a> · <a href="${e(general.pathname + general.search + general.hash)}">General team task</a>` : 'General team task'}</p>
  ${form('task.repeatCreate', `${field('Task title', 'title', 'text', '', 'required maxlength="200"')}<div class="fields">${select('Owner', 'ownerId', options, c.actor.id, 'required')}${field('First due date', 'dueOn', 'date', day, 'required')}${select('Repeat', 'intervalMonths', [['1', 'Monthly'], ['3', 'Quarterly']], '1', 'required')}</div>`, 'Create repeating task', donor ? { donorId: donor.id } : {})}</details>`
 return box('Repeating tasks', `<p>The next task is created when the current task is completed or its due date passes.</p>${list}${create}`, 'repeating-tasks')
}
