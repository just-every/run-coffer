import type { Context } from '../db'
import { taskTeam } from '../task-team'
import { box, e, empty, field, form, select } from './common'

const roles = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export async function taskTeamPanel(c: Context) {
 const { people } = await taskTeam(c)
 const active = new Set(people.map(person => person.id))
 const rows = people.map(person => {
  const options: [string, string][] = [['', 'No manager'], ...people.filter(manager => manager.id !== person.id)
   .map(manager => [manager.id, manager.name] as [string, string])]
  if (person.manager_id && !active.has(person.manager_id)) options.push([person.manager_id, 'Inactive manager — choose a current person'])
  const fields = `<div class="fields">${select('Manager', 'managerId', options, person.manager_id ?? '', `aria-label="${e('Manager for ' + person.name)}"`)}${field('Weekly call capacity', 'weeklyCallCapacity', 'number', person.weekly_call_capacity, `required min="0" max="1000" step="1" aria-label="${e('Weekly call capacity for ' + person.name)}"`)}</div>`
  return `<li><strong>${e(person.name)}</strong> · ${e(roles[person.role])}
   ${form('task.teamSave', fields, 'Record manager', { operatorId: person.id, version: person.version }).replace('<form ', '<form data-task-setting ')}</li>`
 }).join('')
 return box('Team managers', `<p>Choose who each person reports to. Choose No manager to clear a link.</p>${rows ? `<ul class="list">${rows}</ul>` : empty('No active team members.')}`, 'task-team')
}
