import { manager } from '../auth'
import type { Context } from '../db'
import { area, box, chip, e, empty, form, when } from '../ui/common'
import { replyTasks } from './replies'

export async function repliesPanel(c: Context): Promise<string> {
 if(c.actor.role==='agent')return ''
 const tasks = await replyTasks(c)
 return box('Donor replies', tasks.length ? `<ol class="list">${tasks.map(task => {
  if (task.stale_forward) { task.status = 'uncertain'; task.note = 'Forwarding outcome is unknown. Check the assigned person’s inbox before taking action.' }
  const closed = ['done', 'filed'].includes(task.status)
  const status = { forwarded: 'Forwarded · follow-up open', pending: 'Forwarding pending', failed: 'Forwarding failed', uncertain: 'Forwarding unconfirmed', filed: 'Automatic reply filed', done: 'Follow-up done' }[task.status as string] ?? task.status
  const complete = !closed && (manager(c.actor) || task.owner_id === c.actor.id)
   ? form('reply.complete', area('Follow-up outcome', 'notes', '', 'required maxlength="2000"'), 'Finish follow-up', { taskId: task.id }) : ''
  return `<li><h3>${e(task.subject)}</h3><p><a href="/app/donors/${e(task.donor_id)}#timeline">${e(task.donor_name)}</a> · ${when(task.received_at)} · ${e(task.source_kind === 'welcome' ? 'Welcome reply' : 'Appeal reply')}</p>
   <p>${chip(status, task.status === 'failed' || task.status === 'uncertain' ? 'alarm' : closed ? 'ok' : 'info')} · ${e(task.owner_name ?? 'No active owner assigned')}${task.owner_name && task.owner_status !== 'active' ? ' (inactive)' : ''}</p>
   ${task.forwarded_to ? `<p>Forwarding destination: ${e(task.forwarded_to)}</p>` : ''}<p>${e(task.note)}</p>
   <details><summary>Read saved reply excerpt</summary><p class="pre">${e(task.body || 'No plain-text excerpt is available.')}</p></details>${complete}</li>`
 }).join('')}</ol>` : empty('Donor replies will appear here with an assigned person and forwarding result.'), 'donor-replies')
}
