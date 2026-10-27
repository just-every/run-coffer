import { manager } from '../auth'
import { taskOwners } from '../call-tasks'
import { all, type Context, type Row } from '../db'
import { settings } from '../settings'
import { area, box, chip, e, empty, field, form, moment, money, select, when } from '../ui/common'
import { journeyState } from './journeys'

const triggers: [string, string][] = [
 ['gift_amount', 'Gift over an amount'], ['lapse', 'No gift in twelve months'],
 ['lybunt', 'LYBUNT annual list'], ['sybunt', 'SYBUNT annual list'],
 ['recurring', 'Recurring giving starts'], ['anniversary', 'Giving anniversary'],
 ['event', 'Event attendance'], ['saved_list', 'Joins a saved list'],
]
const stageNames: Record<string, string> = { thank: 'Thank-you', impact: 'Impact', ask: 'Next step' }
const conditions: [string, string][] = [['always', 'Always'], ['replied', 'Only if the donor replied'], ['not_replied', 'Only if the donor has not replied']]
const kinds: [string, string][] = [['email', 'Send email'], ['task', 'Create task'], ['wait', 'Wait']]
const states: Record<string, string> = {
 active: 'Active', completed: 'Finished', gave: 'Gave again · stopped', unsubscribed: 'Consent unavailable · stopped',
 inactive: 'Inactive · stopped', deceased: 'Deceased · stopped', stopped: 'Stopped',
}

function stageEditor(step: string, index: number) {
 const label = stageNames[step]
 const timing = step === 'thank' ? '<p class="muted">Due immediately on enrollment.</p>'
  : field(`${label}: days after enrollment`, `${step}Days`, 'number', step === 'impact' ? 7 : 30,
   `required min="${step === 'impact' ? 1 : 2}" max="${step === 'impact' ? 365 : 730}" step="1"`)
 return `<fieldset><legend>${index}. ${e(label)}</legend>${timing}
  <div class="fields">${select(`${label}: action`, `${step}Kind`, kinds, 'email')}
  ${select(`${label}: run condition`, `${step}Condition`, conditions, 'always')}
  ${select(`${label}: purpose`, `${step}IsAsk`, [['no', 'Not an ask'], ['yes', 'Ask or upgrade']], step === 'ask' ? 'yes' : 'no')}</div>
  ${field(`${label}: subject or task title`, `${step}Subject`, 'text', '', 'required maxlength="200"')}
  ${area(`${label}: message or task instructions`, `${step}Body`, '', 'required maxlength="8000" rows="4"')}
 </fieldset>`
}

function publishForm(c: Context, owners: Row[], lists: Row[], events: Row[]) {
 return form('journey.publish', `${field('Journey name', 'name', 'text', '', 'required maxlength="100"')}
  ${select('Enrollment trigger', 'trigger', triggers, 'gift_amount')}
  <details><summary>Trigger settings</summary>
   ${field('Gift must be strictly over this amount (USD; gift amount trigger only)', 'amount', 'number', '1000.00', 'min="0.01" step="0.01"')}
   ${select('Saved list (saved list trigger only)', 'listId', [['', 'Choose a saved list'], ...lists.map(l => [l.id, l.name] as [string, string])])}
   ${select('Event (attendance trigger only)', 'eventId', [['', 'Choose an event'], ...events.map(v => [v.id, `${v.name} · ${v.starts_on}`] as [string, string])])}
   <p class="muted">LYBUNT means positive net giving last calendar year and none this year. SYBUNT includes anyone with positive net giving in an earlier calendar year and none this year, including LYBUNT. These lists use the organization’s calendar.</p>
  </details>
  <p>Choose an email, task or wait for each stage. Reply conditions check recorded donor replies; a new gift ends the series. Day offsets start at enrollment, and the third stage must follow the second. A restricted donor skips ask stages and can continue to a later stage that is not an ask.</p>
  ${select('Task owner (for all task stages)', 'ownerId', [['', 'Choose a task owner'], ...owners.map(o => [o.id, o.name] as [string, string])], owners.some(o => o.id === c.actor.id) ? c.actor.id : '')}
  ${['thank', 'impact', 'ask'].map((step, i) => stageEditor(step, i + 1)).join('')}
  <p class="muted">Use the published merge fields with literal defaults such as {{first_name|Friend}}. Fill every subject and message before publishing. Task stages use them as the title and instructions; wait stages send nothing. Each stage receives a distinct permanent response code. Published messages stay fixed; publish a separate journey for different wording.</p>
  <label><input type="checkbox" name="confirm" value="yes" required> I reviewed all three stages and authorize this journey to enroll matching donors and run its saved actions.</label>`, 'Publish reviewed journey')
}

function journeySummary(j: Row, lists: Row[], events: Row[]) {
 const trigger = triggers.find(([value]) => value === j.trigger)?.[1] ?? j.trigger
 const detail = j.trigger === 'gift_amount' ? ` · strictly over ${money(j.amount_cents)}`
  : j.trigger === 'saved_list' ? ` · ${lists.find(l => l.id === j.list_id)?.name ?? 'Saved list'}`
  : j.trigger === 'event' ? ` · ${events.find(v => v.id === j.event_id)?.name ?? 'Recorded event'}` : ''
 return e(trigger + detail)
}

export async function journeysPanel(c: Context): Promise<string> {
 const canManage = manager(c.actor)
 const [state, s, owners, lists, events] = await Promise.all([
  journeyState(c), settings(c), canManage ? taskOwners(c) : Promise.resolve([]),
  canManage ? all(c, 'SELECT id,name FROM cf_saved_lists ORDER BY lower(name),id') : Promise.resolve([]),
  canManage ? all(c, 'SELECT id,name,starts_on FROM cf_fundraising_events ORDER BY starts_on DESC,id') : Promise.resolve([]),
 ])
 const explanation = '<p>Review and explicitly publish each journey. Publication saves the series; due actions run when you choose Run due journeys or when the scheduler runs. Email checks current consent before submission. New gifts, inactive or deceased status, unavailable consent and changes to list eligibility stop pending work. An uncertain submission needs investigation and is never retried automatically.</p>'
 const cap = `<p>Shared cap: one email per donor across ${e(state.capDays)} organization calendar day${state.capDays===1?'':'s'}. Held steps stay pending. ${canManage?'<a href="/app/settings#journey-frequency">Change the cap in Settings</a>':''}</p>`
 const journeys = state.journeys.map((j: Row) => `<li><details><summary>${e(j.name)} · ${e(j.stopped_at?'Stopped':'Published')}</summary><p>${journeySummary(j, lists, events)} · Published ${when(j.published_at, s.timezone)} ${chip(j.stopped_at ? 'Stopped' : 'Published', j.stopped_at ? '' : 'ok')}</p>
  <ol>${j.steps.map((step: Row) => `<li><strong>${e(stageNames[step.step] ?? step.step)}</strong> · ${e(kinds.find(([value]) => value === step.kind)?.[1] ?? step.kind)} · ${e(step.delay_days ? `Day ${step.delay_days}` : 'Immediately')} ${chip(step.is_ask ? 'Ask' : 'Not an ask')}<p>${e(conditions.find(([value]) => value === step.condition)?.[1] ?? step.condition)}</p><p><strong>${e(step.subject)}</strong></p><p class="preserve">${e(step.body)}</p><p>Response code: <span class="copy">${e(step.code)}</span></p></li>`).join('')}</ol>
  ${canManage && !j.stopped_at ? form('journey.stop', '<label><input type="checkbox" name="confirm" value="yes" required> Stop new enrollments and cancel this journey’s pending steps.</label>', 'Stop journey', { journeyId: j.id }) : ''}</details></li>`).join('')
 const enrollments = state.enrollments.map((row: Row) => `<li><a href="/app/donors/${e(row.donor_id)}">${e(row.name)}</a> · ${e(row.journey_name)} ${chip(states[row.status] ?? row.status)}
  <ul>${row.steps.map((step: Row) => `<li>${e(stageNames[step.step] ?? step.step)} · Due ${when(step.due_at, s.timezone)} ${chip(step.status, step.status === 'uncertain' ? 'warn' : '')}${step.note ? `<p class="muted">${e(step.note)}</p>` : ''}</li>`).join('')}</ul></li>`).join('')
 const run = canManage && state.journeys.length ? form('journey.run', '<p>Check current eligibility and run due stages under the shared frequency cap.</p>', 'Run due journeys') : ''
 return box('Stewardship journeys', explanation + cap + run, 'stewardship-journeys')
  + (canManage ? box('Publish a new journey', `<details class="edit"><summary>Build a three-stage journey</summary>${publishForm(c, owners, lists, events)}</details>`) : '')
  + (state.mergeReview.length?box('Empty journey fields',`<ul>${state.mergeReview.map((r:Row)=>`<li><a href="/app/donors/${e(r.donor_id)}">${e(r.name)}</a> · ${e(r.journey_name)}: ${r.fields.map((f:string)=>`<code>{{${e(f)}}}</code>`).join(', ')}</li>`).join('')}</ul>`):'')
  + box('Published journeys', journeys ? `<ul class="list">${journeys}</ul><p class="muted">Gift responses count only when a gift carries the published stage’s response code.</p>` : empty('No stewardship journeys published yet.'))
  + box('Journey enrollments', enrollments ? `<ul class="list">${enrollments}</ul>` : empty('No donors enrolled in stewardship journeys yet.'))
}

export function journeyDonorPanel(rows: Row[]): string {
 return box('Stewardship journeys', rows.length ? `<ul class="list">${rows.map(row => `<li><strong>${e(row.journey_name)}</strong> ${chip(states[row.status] ?? row.status)}<p class="muted">Enrolled ${e(moment(row.enrolled_at, 'UTC'))} UTC</p></li>`).join('')}</ul>` : empty('No stewardship journey enrollments.'))
}

export async function journeySettingsPanel(c:Context):Promise<string>{
 if(!manager(c.actor))return ''
 const state=await journeyState(c)
 return box('Journey email frequency',form('journey.cap',field('Organization calendar days per journey email','capDays','number',state.capDays,'required min="1" max="365" step="1"')+'<p>Across the welcome series and other journeys, reserve one email slot per donor in this many organization calendar days. Uncertain submissions keep their reservation. Tasks, waits and transactional notices do not consume it.</p><label><input type="checkbox" name="confirm" value="yes" required> Apply this cap to all journeys.</label>','Save journey frequency'),'journey-frequency')
}
