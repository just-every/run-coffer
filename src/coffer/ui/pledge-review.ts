import type { Row } from '../db'
import { e, form } from './common'

export function pledgeEmailReview(pledge: Row, donor: Row, template: Row, settings: Row): string {
 return `<details class="edit"><summary>Review held pledge email</summary>
  <p>Review the commitment and installment schedule above, then the current reminder wording below. Fields are filled from current donor and pledge records when a reminder is due.</p>
  <p><strong>Reminder wording · version ${e(template.version)}</strong></p><p>${e(template.subject)}</p><p class="preserve">${e(template.body)}</p>
  <p>Releasing permits ordinary due reminders and overdue follow-ups under current email permission. Empty reminder fields remain held. It does not send an email now.</p>
  <p><a href="/app/settings#pledge-template">Edit reminder wording</a></p>
  ${form('pledge.releaseEmail', '<label><input type="checkbox" name="reviewed" value="yes" required> I reviewed this pledge, its schedule and current reminder wording.</label>', 'Release pledge email', {
   donorId: donor.id, pledgeId: pledge.id, version: pledge.version, donorVersion: donor.version,
   templateVersion: template.version, settingsVersion: settings.version,
  })}</details>`
}
