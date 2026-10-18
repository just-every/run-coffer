import type { Context, Row } from '../db'
import { pledgeMailUnavailable } from '../pledges'
import { area, box, chip, e, empty, field, form, longDay, money, select } from './common'

export function pledgeFields(day: string): string {
 return `<div class="fields">${field('Pledge amount (USD)', 'amount', 'text', '', 'required inputmode="decimal"')}${field('Pledged on', 'pledgedOn', 'date', day, 'required')}${field('Fund', 'fund', 'text', 'Unrestricted', 'required')}${field('Remind days before each installment', 'reminderDays', 'number', 7, 'required min="1" max="365"')}</div>
 ${area('Dated installments — one per line: YYYY-MM-DD | amount (USD)', 'schedule', '', 'required rows="5" placeholder="2026-12-01 | 100.00&#10;2027-01-01 | 100.00"')}<p class="muted">Installments must total the pledge. Reminders use the donor’s current email permission. Recording a pledge does not record a gift.</p>`
}

export function installmentFields(pledges: Row[]): string {
 const options: [string, string][] = [['', 'No pledge installment']]
 for (const p of pledges) for (const i of p.installments ?? []) {
  if (i.remaining_cents > 0) options.push([i.id, `${longDay(i.due_on)} · ${money(i.remaining_cents)} remaining · ${p.fund}`])
 }
 return options.length > 1 ? select('Toward pledge installment', 'installmentId', options) : ''
}

const reminderLabel = (i: Row, day: string): string => {
 if (i.remaining_cents === 0) return chip('Paid', 'ok')
 if (i.reminder_status === 'submitted') return chip('Reminder submitted', 'info')
 if (i.reminder_status === 'sending') return chip('Submission in progress or unconfirmed', 'warn')
 if (i.reminder_status === 'uncertain') return chip('Submission uncertain · check SendGrid', 'warn')
 if (i.reminder_status === 'rejected') return chip('Reminder not accepted', 'alarm')
 if (i.reminder_status === 'skipped') return chip('Reminder skipped', 'warn')
 return i.remind_on <= day ? chip('Reminder due', 'warn') : chip(`Remind ${longDay(i.remind_on)}`)
}

/** history is the full donor history; its pledges come from pledgeHistory. */
export async function pledgePanel(c: Context, history: Row, day: string, staff: boolean): Promise<string> {
 const pledges: Row[] = history.pledges, donorId: string = history.donor.id
 const unavailable = pledgeMailUnavailable(c.env)
 const list = pledges.length ? `<ul class="list">${pledges.map(p => `<li><strong>${money(p.amount_cents)} pledged ${longDay(p.pledged_on)} to ${e(p.fund)}</strong><br>${money(p.paid_cents)} paid · ${money(p.remaining_cents)} still to come
  ${p.installments?.length ? `<ul>${p.installments.map((i: Row) => `<li>${longDay(i.due_on)} · ${money(i.amount_cents)} scheduled · ${money(i.remaining_cents)} remaining ${i.due_on < day && i.remaining_cents > 0 ? chip('Overdue', 'alarm') : ''} ${reminderLabel(i, day)}${i.reminder_note ? `<p class="muted">${e(i.reminder_note)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="muted">This older pledge has no installment schedule.</p>'}
  ${staff && !unavailable && p.installments?.some((i: Row) => i.reminder_status === 'pending' && i.remind_on <= day && i.remaining_cents > 0) ? form('pledge.remind', '<p>Send only unpaid installments whose reminder date has arrived and whose donor has email permission.</p>', 'Send due reminders', { donorId, pledgeId: p.id }) : ''}</li>`).join('')}</ul>` : empty('No pledges.')
 const installments = installmentFields(pledges)
 // Explicit matching also supports gifts imported or recorded before the schedule.
 const gifts = (history.gifts ?? []).filter((g: Row) => g.kind === 'gift' && !g.reversed_by)
 const match = staff && installments && gifts.length ? `<details class="edit"><summary>Match a recorded gift to an installment</summary>${form('pledge.match', `${select('Recorded gift', 'giftId', gifts.map((g: Row) => [g.id, `${longDay(g.received_on)} · ${money(g.amount_cents)} · ${g.fund}`] as [string, string]))}${installments}${field('Amount to match (USD; blank uses unmatched balance)', 'allocationAmount', 'text', '', 'inputmode="decimal"')}`, 'Match gift', { donorId })}</details>` : ''
 const create = staff ? `<details class="edit"><summary>Record a pledge</summary>${form('pledge.create', pledgeFields(day), 'Record pledge', { donorId })}</details>` : ''
 return box('Pledges', `${list}${unavailable ? `<p class="muted">${e(unavailable)}</p>` : '<p class="muted">Due reminders send once through SendGrid. Submitted means accepted by the provider; delivery is not confirmed.</p>'}${match}${create}`)
}
