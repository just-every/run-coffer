import { manager } from '../auth'
import type { Context, Row } from '../db'
import { area, box, chip, e, empty, field, form, when } from '../ui/common'
import { welcomeState } from './welcome'

const stepLabel: Record<string, string> = { thank: 'Thank-you', impact: 'Impact', ask: 'Second ask' }
const stateLabel: Record<string, string> = { active: 'Active', completed: 'Finished', gave: 'Gave again · series stopped', unsubscribed: 'Consent unavailable · stopped' }

/** Embedded by the Appeals page; uses the existing cards and action forms. */
export async function welcomePanel(c: Context): Promise<string> {
 const state = await welcomeState(c), w = state.journey, boss = manager(c.actor)
 const active = state.activeCount > 0
 const publication = w ? `<p>Published ${when(w.published_at)} · saved by ${e(w.published_by)}.</p>` : '<p>Publish three saved messages to welcome future first-time donors.</p>'
 const explanation = '<p class="muted">Only first gifts recorded after publication enroll, once per donor. Backdated gifts before launch are excluded. Timing starts when the gift was recorded. Email consent is required for every message. A second recorded gift stops all remaining steps, even if later reversed.</p>'
 const editor = boss && !active ? form('welcome.publish', `
  <h3>1. Thank-you · immediately</h3>${field('Thank-you subject', 'thankSubject', 'text', w?.thank_subject ?? '', 'required maxlength="200"')}${area('Thank-you message', 'thankBody', w?.thank_body ?? '', 'required maxlength="8000" rows="5"')}
  <h3>2. Impact update</h3>${field('Days after first gift', 'impactDays', 'number', w?.impact_days ?? 7, 'required min="1" max="365"')}${field('Impact subject', 'impactSubject', 'text', w?.impact_subject ?? '', 'required maxlength="200"')}${area('Impact message', 'impactBody', w?.impact_body ?? '', 'required maxlength="8000" rows="5"')}
  <h3>3. Second-gift ask</h3>${field('Days after first gift (after the impact update)', 'askDays', 'number', w?.ask_days ?? 30, 'required min="2" max="730"')}${field('Second-ask subject', 'askSubject', 'text', w?.ask_subject ?? '', 'required maxlength="200"')}${area('Second-ask message', 'askBody', w?.ask_body ?? '', 'required maxlength="8000" rows="5"')}
  <p class="muted">Merge fields: {{donor_name}}, {{total_given}}, {{last_gift}}, {{gift_count}}. Publishing saves all three messages. Messages cannot be changed while a series is active.</p>`, w ? 'Publish saved changes' : 'Publish welcome series', { publishedAt: w?.published_at ?? '' })
  : boss ? '<p class="muted">Messages are saved for the active series. Finish active journeys before publishing changes.</p>' : '<p class="muted">An owner or admin publishes and runs the welcome series.</p>'
 const saved = w && (!boss || active) ? `<ol><li>Thank-you · immediately<br><strong>${e(w.thank_subject)}</strong><p class="preserve">${e(w.thank_body)}</p></li><li>Impact · day ${e(w.impact_days)}<br><strong>${e(w.impact_subject)}</strong><p class="preserve">${e(w.impact_body)}</p></li><li>Second ask · day ${e(w.ask_days)}<br><strong>${e(w.ask_subject)}</strong><p class="preserve">${e(w.ask_body)}</p></li></ol>` : ''
 const run = boss && w ? form('welcome.run', '<p class="muted">Check new first gifts and submit messages due now. Uncertain submissions are never retried automatically.</p>', 'Run due welcome steps') : ''
 const enrolled = state.enrollments.length ? `<ul class="list">${state.enrollments.map((enrollment: Row) => `<li><a href="/app/donors/${e(enrollment.donor_id)}">${e(enrollment.name)}</a> · ${e(enrollment.email || 'No email address')} ${chip(stateLabel[enrollment.status] ?? enrollment.status)}<br><span class="muted">Enrolled ${when(enrollment.enrolled_at)}</span><ul>${enrollment.steps.map((step: Row) => `<li>${e(stepLabel[step.step] ?? step.step)} · due ${when(step.due_at)} ${chip(step.status, step.status === 'uncertain' ? 'warn' : '')}${step.note ? `<br><span class="muted">${e(step.note)}</span>` : ''}</li>`).join('')}</ul></li>`).join('')}</ul><p class="muted">Showing the latest 100 enrollments.</p>` : empty('No first-time donors enrolled yet.')
 return `${box('First-gift welcome series', publication + explanation + saved + editor + run)}${box('Welcome journeys', enrolled)}`
}
