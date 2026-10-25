import type { Context, Row } from '../db'
import { reportSchedules } from '../report-schedules'
import { area, box, chip, e, empty, field, form, moment, select } from './common'

const utc = (at: string | null | undefined) => at ? `${e(moment(at, 'UTC'))} UTC` : 'Not recorded'
const outcome = (status: string) => {
 const states: Record<string, [string, string]> = {
  sending: ['Sending', 'info'],
  submitted: ['Email submitted', 'info'],
  uncertain: ['Delivery unconfirmed', 'warn'],
  rejected: ['Email rejected', 'alarm'],
  held: ['Held', 'warn'],
 }
 const [label, tone] = states[status]
 return chip(label, tone)
}

function recipientApprovals(schedule: Row) {
 return (schedule.approvals as Row[]).map(approval => `<div><p>${e(approval.recipient)}${approval.revoked_at ? `<br>${chip('Approval revoked', 'warn')}` : ''}</p>${approval.revoked_at ? '' : form('reportSchedule.revokeRecipient', '', 'Revoke recipient', { scheduleId: schedule.id, recipient: approval.recipient }, 'secondary')}</div>`).join('')
}

function scheduleItem(schedule: Row) {
 return `<tr><td class="lead"><strong>${e(schedule.name)}</strong><br>${chip(schedule.enabled ? 'Active' : 'Paused', schedule.enabled ? 'info' : '')}</td>
  <td data-label="Report"><a href="${e(schedule.report_path)}">Open saved report</a><br>${e(schedule.report_path)}</td>
  <td data-label="Recipients">${recipientApprovals(schedule)}</td>
  <td data-label="Next send">${schedule.cadence === 'weekly' ? 'Weekly' : 'Monthly'}<br>${utc(schedule.next_at)}</td>
  <td data-label="Actions">${schedule.enabled ? form('reportSchedule.pause', '', 'Pause schedule', { scheduleId: schedule.id, version: schedule.version }) : 'Paused'}</td></tr>`
}

function runItem(run: Row, retried: Set<string>) {
 const resend = run.status === 'uncertain' && !retried.has(run.id) ? form('reportSchedule.resend', `<label><input type="checkbox" name="reviewed" value="yes" required> I checked the provider and authorize resending this report. The recipient may receive a duplicate.</label>`, 'Resend report', { runId: run.id }) : ''
 return `<tr id="report-run-${e(run.id)}"><td class="lead"><strong>${e(run.name)}</strong><br>${e(run.recipient)}${run.retry_of ? `<br>${chip('Manual resend')}` : ''}</td><td data-label="Outcome">${outcome(run.status)}${run.detail ? `<p>${e(run.detail)}</p>` : ''}${retried.has(run.id) ? '<p>A manual resend is recorded.</p>' : ''}${resend}</td>
  <td data-label="Due">${utc(run.due_at)}</td><td data-label="Attempted">${utc(run.attempted_at)}</td>
  <td data-label="Report"><a href="${e(run.report_path)}">Open report</a>${run.message_id ? `<br>Mail reference: ${e(run.message_id)}` : ''}</td></tr>`
}

export async function reportSchedulesPage(c: Context, url: URL) {
 const data = await reportSchedules(c)
 const retried = new Set<string>(data.runs.filter(run => run.retry_of).map(run => run.retry_of))
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
  ${box('Saved report schedules', data.schedules.length ? `<div class="scroll"><table class="stack"><thead><tr><th>Schedule</th><th>Report</th><th>Recipients</th><th>Next send (UTC)</th><th>Actions</th></tr></thead><tbody>${data.schedules.map(scheduleItem).join('')}</tbody></table></div>` : empty('No report schedules saved yet.'),'report-schedule-list')}
  ${box('Mail outcomes', `<p>Email submitted means the mail provider accepted the request; it does not confirm delivery. Review unconfirmed, rejected and held runs. Before resending an unconfirmed report, check the provider for possible delivery.</p>${data.runs.length ? `<div class="scroll"><table class="stack"><thead><tr><th>Report and recipient</th><th>Outcome</th><th>Due (UTC)</th><th>Attempted (UTC)</th><th>Report</th></tr></thead><tbody>${data.runs.map(run => runItem(run, retried)).join('')}</tbody></table></div>` : empty('No scheduled report runs yet.')}`,'report-mail-outcomes')}`
}
