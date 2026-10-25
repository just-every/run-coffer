import type { Context, Row } from '../db'
import { reportSchedules } from '../report-schedules'
import { area, box, chip, e, empty, field, form, moment, select } from './common'

const utc = (at: string | null | undefined) => at ? `${e(moment(at, 'UTC'))} UTC` : 'Not recorded'
const recipients = (value: string) => (JSON.parse(value) as string[]).map(address => e(address)).join(', ')
const outcome = (status: string) => {
 const states: Record<string, [string, string]> = {
  sending: ['Sending', 'info'],
  submitted: ['Email submitted', 'info'],
  uncertain: ['Submission uncertain', 'warn'],
  rejected: ['Email rejected', 'alarm'],
  held: ['Held', 'warn'],
 }
 const [label, tone] = states[status]
 return chip(label, tone)
}

function scheduleItem(schedule: Row) {
 return `<li><h3>${e(schedule.name)}</h3>
  <p>${chip(schedule.enabled ? 'Active' : 'Paused', schedule.enabled ? 'info' : '')} · ${schedule.cadence === 'weekly' ? 'Weekly' : 'Monthly'}</p>
  <p><a href="${e(schedule.report_path)}">Open saved report</a><br>${e(schedule.report_path)}</p>
  <p><strong>Recipients:</strong> ${recipients(schedule.recipients)}</p>
  <p><strong>${schedule.enabled ? 'Next send' : 'Saved next send'}:</strong> ${utc(schedule.next_at)}</p>
  ${schedule.enabled ? form('reportSchedule.pause', '', 'Pause schedule', { scheduleId: schedule.id, version: schedule.version }) : ''}</li>`
}

function runItem(run: Row) {
 return `<li><h3>${e(run.name)}</h3><p>${outcome(run.status)}</p>
  <p><strong>Due:</strong> ${utc(run.due_at)}<br><strong>Attempted:</strong> ${utc(run.attempted_at)}</p>
  ${run.detail ? `<p>${e(run.detail)}</p>` : ''}
  ${run.message_id ? `<p><strong>Mail reference:</strong> ${e(run.message_id)}</p>` : ''}
  <p><strong>Recipient:</strong> ${e(run.recipient)}<br><a href="${e(run.report_path)}">Open report</a></p></li>`
}

export async function reportSchedulesPage(c: Context, url: URL) {
 const data = await reportSchedules(c)
 const selected = url.searchParams.get('reportPath') ?? ''
 const options = `<datalist id="schedule-reports">${data.available.map(report => `<option value="${e(report.path)}">${e(report.label)}</option>`).join('')}</datalist>`
 const create = form('reportSchedule.save', `
  <div class="fields">${field('Schedule name', 'name', 'text', '', 'required maxlength="100"')}${select('Cadence', 'cadence', [['weekly', 'Weekly'], ['monthly', 'Monthly']], 'weekly', 'required')}</div>
  ${field('Report URL with filters', 'reportPath', 'text', selected, 'required list="schedule-reports" aria-describedby="schedule-report-help"')}${options}
  <p id="schedule-report-help" class="muted">Choose a report or paste its relative URL beginning with /app/. Keep the full query string to save every selected filter.</p>
  ${area('Recipient email addresses', 'recipients', '', 'required rows="3" aria-describedby="schedule-recipient-help"')}
  <p id="schedule-recipient-help" class="muted">Separate addresses with commas or new lines. Each recipient will receive the report contents.</p>
  ${field('First send (UTC)', 'startsAt', 'datetime-local', '', 'required')}
  <label><input type="checkbox" name="reviewed" value="yes" required> I reviewed this report and authorize emailing its contents to these recipients on this schedule.</label>`, 'Save email schedule')
 return `${data.mailIssue?`<p class="notice" role="status">${e(data.mailIssue)}</p>`:''}${box('Schedule a report', `<p>Save the selected report URL, including its filters, for a weekly or monthly email. All schedule times are UTC. The attachment is the complete selected report as JSON.</p>${create}`)}
  ${box('Saved report schedules', data.schedules.length ? `<ul class="list">${data.schedules.map(scheduleItem).join('')}</ul>` : empty('No report schedules saved yet.'))}
  ${box('Mail outcomes', `<p>Email submitted means the mail provider accepted the request; it does not confirm delivery. Uncertain, rejected and held runs require review.</p>${data.runs.length ? `<ul class="list">${data.runs.map(runItem).join('')}</ul>` : empty('No scheduled report runs yet.')}`)}`
}
