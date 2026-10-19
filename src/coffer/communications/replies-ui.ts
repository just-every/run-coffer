import { manager } from '../auth'
import type { Context } from '../db'
import { settings } from '../settings'
import { area, box, chip, e, empty, form, when } from '../ui/common'
import { replySource, replyTasks } from './replies'

export async function repliesPanel(c: Context): Promise<string> {
 if(c.actor.role==='agent')return ''
 const tasks = await replyTasks(c), tz = (await settings(c)).timezone
 return box('Donor replies', tasks.length ? `<ol class="list">${tasks.map(task => {
  if (task.stale_forward) { task.status = 'uncertain'; task.note = 'Forwarding outcome is unknown. Check the assigned person’s inbox before taking action.' }
  const closed = ['done', 'filed'].includes(task.status)
  const status = { forwarded: 'Forwarded · follow-up open', pending: 'Forwarding pending', failed: 'Forwarding failed', uncertain: 'Forwarding unconfirmed', filed: 'Automatic reply filed', done: 'Follow-up done' }[task.status as string] ?? task.status
  const complete = !closed && (manager(c.actor) || task.owner_id === c.actor.id)
   ? form('reply.complete', area('Follow-up outcome', 'notes', '', 'required maxlength="2000"'), 'Finish follow-up', { taskId: task.id }) : ''
  let stop = ''
  if (task.stop_status === 'automatic') stop = `<div class="box"><h4>Email consent withdrawn automatically</h4><p class="pre">${e(task.stop_evidence)}</p><p>This explicit stop request withdrew email consent when it arrived.</p>${task.can_reverse_stop
   ? form('reply.reverseStop', area('Why the explicit request was misread', 'reason', '', 'required maxlength="1000"'), 'Reverse misread withdrawal', { taskId: task.id, stopVersion: task.stop_version })
   : '<p>A newer preference or donor change prevents reversal from this reply. Review the donor record.</p>'}</div>`
  else if (task.stop_status === 'reversed') stop = `<p>${chip('Misread withdrawal reversed', 'info')} · ${e(task.stop_reversed_by)} on ${when(task.stop_reversed_at, tz)}.</p><p class="pre">${e(task.stop_reversal_reason)}</p>`
  else if (task.stop_status === 'confirmed') stop = `<p>${chip('Email consent withdrawn', 'ok')} · Confirmed by ${e(task.stop_confirmed_by)} on ${when(task.stop_confirmed_at, tz)}.</p>`
  else if (task.stop_status === 'proposed') {
   stop = `<div class="box"><h4>Proposed email consent withdrawal</h4><p class="pre">${e(task.stop_evidence)}</p><p>Review the saved reply. Confirming records that this donor no longer consents to email.</p>${task.stale_stop
    ? `<p role="status">The donor email or consent changed. Review the current donor record and saved reply before proposing again.</p>${form('reply.proposeStop', '', 'Review and propose withdrawal again', { taskId: task.id, stopVersion: task.stop_version })}`
    : form('reply.confirmStop', '', 'Confirm email consent withdrawal', { taskId: task.id, stopVersion: task.stop_version })}</div>`
  } else if (!task.automatic && task.body) stop = form('reply.proposeStop', '<p>If this reply asks to stop email, propose a withdrawal for review.</p>', 'Propose email consent withdrawal', { taskId: task.id, stopVersion: task.stop_version })
  return `<li><h3>${e(task.subject)}</h3><p><a href="/app/donors/${e(task.donor_id)}#timeline">${e(task.donor_name)}</a> · ${when(task.received_at, tz)} · ${e(replySource(task.source_kind) + ' reply')}</p>
   <p>${chip(status, task.status === 'failed' || task.status === 'uncertain' ? 'alarm' : closed ? 'ok' : 'info')} · ${e(task.owner_name ?? 'No active owner assigned')}${task.owner_name && task.owner_status !== 'active' ? ' (inactive)' : ''}</p>
   ${task.forwarded_to ? `<p>Forwarding destination: ${e(task.forwarded_to)}</p>` : ''}<p>${e(task.note)}</p>
   <details><summary>Read saved reply excerpt</summary><p class="pre">${e(task.body || 'No plain-text excerpt is available.')}</p></details>${stop}${complete}</li>`
 }).join('')}</ol>` : empty('Donor replies will appear here with an assigned person and forwarding result.'), 'donor-replies')
}
