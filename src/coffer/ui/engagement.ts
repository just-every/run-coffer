import { manager } from '../auth'
import { type Context, type Row } from '../db'
import { ENGAGEMENT_COMPONENTS, engagementPolicy } from '../engagement'
import { box, chip, e, field, form, longDay, money } from './common'

const labels = { recency: 'Recency', frequency: 'Giving frequency', amount: 'Giving amount', conversations: 'Conversations', volunteering: 'Volunteering', attendance: 'Event attendance', opens:'Provider-reported opens' }

export function engagementDetails(score: Row | null): string {
 if (!score) return ''
 const s = score
 return box('Engagement and retention', `<p>${chip(`${s.score}/100`)} · as of ${longDay(s.asOf)} · policy version ${s.policyVersion}</p>
 <dl class="engagement-inputs"><dt>Recency</dt><dd>${s.recency.lastOn ? `${longDay(s.recency.lastOn)} · ${s.recency.days} days ago` : 'No eligible giving or activity history'} → ${s.recency.points}/${s.recency.weight}</dd>
 <dt>Giving frequency</dt><dd>${s.frequency.gifts} eligible gifts → ${s.frequency.points}/${s.frequency.weight}</dd>
 <dt>Giving amount</dt><dd>${money(s.amount.cents)} → ${s.amount.points}/${s.amount.weight}</dd>
 <dt>Conversations</dt><dd>${s.conversations.count} interactions: ${s.conversations.calls} calls, ${s.conversations.meetings} meetings, ${s.conversations.emails} emails (including ${s.conversations.replies} received replies) → ${s.conversations.points}/${s.conversations.weight}</dd><dt>Volunteering</dt><dd>${s.volunteering.hours} hours in ${s.volunteering.activities} activities → ${s.volunteering.points}/${s.volunteering.weight}</dd><dt>Event attendance</dt><dd>${s.attendance.count} checked-in registrations → ${s.attendance.points}/${s.attendance.weight}</dd><dt>Provider-reported opens</dt><dd>${s.opens.documents} documents · SendGrid → ${s.opens.points}/${s.opens.weight}. Provider-reported open, not proof of reading.</dd></dl>
 <p>${chip(s.retentionRisk.status === 'at_risk' ? 'Retention risk' : s.retentionRisk.status === 'unknown' ? 'Retention risk unknown' : 'Giving is current', s.retentionRisk.flag ? 'warn' : '')} ${e(s.retentionRisk.reason)}</p>
 <p>Frequency, amount, conversations, volunteering and attendance use the past 365 calendar days, including today. <a href="/app/engagement">Read the scoring formula and weights</a>.</p>`, 'engagement')
}

export async function engagementPage(c: Context): Promise<string> {
 const policy = await engagementPolicy(c)
 const description = `<p>Every current constituent has a score, whether or not they have an opportunity. Weights total 100; each component contributes its base points × its weight ÷ 25. Components and their sum are rounded to two decimal places.</p>
 <ul><li>Recency: the most recent eligible gift, meaningful interaction, volunteer activity or event check-in earns 25 base points within 30 days, 15 within 90 days, 5 within 365 days, otherwise zero.</li>
 <li>Frequency: 5 base points per eligible gift in the last 365 calendar days, capped at 25.</li>
 <li>Amount: 5 base points per complete $100 of eligible gifts in that window, capped at 25.</li>
 <li>Conversations: 5 base points per meaningful recorded call, meeting or email in that window, capped at 25. Received replies count through their email interaction once; automatic replies and unanswered calls are excluded.</li><li>Volunteering: 5 base points per complete hour recorded in that window, capped at 25. Its default weight is zero; set a weight to include hours in the score.</li><li>Event attendance: 5 base points per checked-in registration in that window, capped at 25. Its default weight is zero. Registrations without a check-in and future check-ins do not score.</li><li>Provider-reported opens: 5 base points per distinct document with a signed SendGrid open in that window, capped at 25, default weight zero. Repeated opens of the same document count once. Actual provider events appear on the donor’s timeline. These are not proof of reading and do not affect giving recency or retention risk. Opens exist only if the owner’s SendGrid account already has Open Tracking on; Coffer does not turn tracking on.</li></ul>
 <p>The window includes today and the preceding 364 days in the organization’s time zone. Future records, gifts with any refund or reversal, pledges, soft credits and planned asks do not score.</p>
 <p>Retention risk is independent of the score: a donor is at risk when their last gift with a positive current balance was more than 365 days ago. No giving history means unknown risk. Recent conversations and changes to weights never clear this flag.</p>`
 const weights = `<dl>${ENGAGEMENT_COMPONENTS.map(key => `<dt>${labels[key]}</dt><dd>${policy.weights[key]} points maximum</dd>`).join('')}</dl>`
 const edit = manager(c.actor) ? form('engagement.settings', `<div class="fields">${ENGAGEMENT_COMPONENTS.map(key => field(`${labels[key]} weight`, key, 'number', policy.weights[key], 'required min="0" max="100" step="1"')).join('')}</div><p>The whole-number weights must add to 100. Saving recalculates every current constituent from the same recorded facts.</p>`, 'Save score weights', { version: policy.version }) : '<p>An owner or administrator can change the weights.</p>'
 return `${box('Scoring formula', description)}${box(`Current weights · version ${policy.version}`, weights + edit)}`
}
