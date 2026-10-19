import type { Row } from '../db'
import { SOFT_ACK_METHODS } from '../soft-credit-ack'
import { area, box, chip, e, empty, field, form, longDay, money, select } from './common'

type GiftDepth = { softCredits: Row[]; creditedGifts: Row[]; recognitionCents: number; tributes: Row[]; matches: Row[] }
const donorLink = (id: string, name: string) => `<a href="/app/donors/${e(id)}">${e(name)}</a>`
const giftLabel = (g: Row) => `${money(g.amount_cents)} · ${longDay(g.received_on)} · ${g.reference || g.fund}`
const donorOptions = (donors: Row[]): [string, string][] => donors.filter(d => !d.erased_at).map(d => [d.id, `${d.name}${d.email ? ` · ${d.email}` : ''}`])
const amountField = (label: string) => field(label, 'amount', 'text', '', 'required inputmode="decimal" placeholder="250.00"')

function acknowledgment(credit: Row): string {
 const a = credit.acknowledgment
 if (!a || a.status === 'not acknowledged') return '<p>Soft-credit thank-you: Not acknowledged</p>'
 if (a.status === 'do not acknowledge') return `<p>Soft-credit thank-you: Do not acknowledge · ${e(a.reason)}</p>`
 return `<p>Soft-credit thank-you: Acknowledged · ${longDay(a.acknowledgedOn)} · ${e(a.method)}</p><details><summary>Linked thank-you ${a.link?.kind === 'interaction' ? 'conversation' : 'note'}</summary><p>${e(a.link?.content).replace(/\n/g, '<br>')}</p><p><a href="/app/donors/${e(credit.donor_id)}#timeline">View constituent timeline</a></p></details>`
}

function acknowledgmentForms(credit: Row, donorId: string, managers: boolean): string {
 const values = { softCreditId: credit.id, version: credit.acknowledgment?.version ?? 0, returnDonorId: donorId }
 return `<details class="edit"><summary>Record a separate thank-you</summary><p>Record a thank-you already given to this credited constituent. The message or interaction notes are saved on their timeline. This does not send a message or create a tax receipt.</p>${form('softCredit.acknowledge', `<div class="fields">${field('Thank-you date', 'acknowledgedOn', 'date', '', `required min="${e(credit.received_on)}"`)}${select('Thank-you method', 'method', SOFT_ACK_METHODS)}</div>${area('Thank-you message or interaction notes', 'notes', '', 'required maxlength="8000"')}`, 'Record soft-credit thank-you', values)}</details>
 ${credit.acknowledgment?.status !== 'not acknowledged' ? form('softCredit.resetAcknowledgment', '', 'Mark soft credit not acknowledged', values) : ''}
 ${managers ? `<details class="edit"><summary>Do not acknowledge this soft credit</summary>${form('softCredit.doNotAcknowledge', field('Reason not to acknowledge', 'reason', 'text', '', 'required maxlength="1000"'), 'Save soft-credit acknowledgment exclusion', values)}</details>` : ''}`
}

/** Small read-only attribution block for the existing gift table. */
export function giftAttribution(gift: Row, depth: GiftDepth): string {
 const credits = depth.softCredits.filter(s => s.gift_id === gift.id), tribute = depth.tributes.find(t => t.gift_id === gift.id)
 const matches = depth.matches.filter(m => m.gift_id === gift.id)
 return `${credits.map(s => `<p class="muted">Recognition: ${donorLink(s.donor_id, s.credited_donor_name)} · ${money(s.recognized_cents)}${s.active ? '' : ' (reversed gift; excluded)'}</p>${acknowledgment(s)}`).join('')}${tribute ? `<p>In ${tribute.kind === 'memory' ? 'memory' : 'honor'} of ${e(tribute.honoree)}${tribute.active ? '' : ' (gift reversed)'}${tribute.notified_name ? `<br><span class="muted">Notification contact: ${e(tribute.notified_name)}${tribute.notified_email ? ` · ${e(tribute.notified_email)}` : ''}</span>` : ''}</p>` : ''}${matches.map(m => `<p>Employer match: ${donorLink(m.employer_donor_id, m.employer_name)} · ${money(m.amount_cents)} · ${chip(m.status, m.status === 'overdue' ? 'alarm' : m.status === 'received' ? 'ok' : '')}${m.status === 'received' ? ` ${longDay(m.matched_on)}` : ` · due ${longDay(m.due_by)}`}</p>`).join('')}`
}

/** Render with every live donor option, rather than asking staff to paste IDs. */
export function giftDepthForms(donorId: string, gifts: Row[], donors: Row[], depth: GiftDepth, staff = true, managers = false): string {
 const liveGifts = gifts.filter(g => g.kind === 'gift' && !g.reversed_by), others = donorOptions(donors.filter(d => d.id !== donorId))
 const giftSelect = () => select('Original gift', 'giftId', [['', 'Choose a received gift'], ...liveGifts.map(g => [g.id, giftLabel(g)] as [string, string])], '', 'required')
 const creditList = depth.creditedGifts.length ? `<ul class="list">${depth.creditedGifts.map(s => `<li>${money(s.recognized_cents)} recognized for a gift from ${donorLink(s.gift_donor_id, s.gift_donor_name)} on ${longDay(s.received_on)} ${s.active ? chip('Recognition only') : chip('Gift reversed; excluded')}${acknowledgment(s)}${staff ? acknowledgmentForms(s, donorId, managers) : ''}${staff ? form('softCredit.remove', '', 'Remove recognition', { softCreditId: s.id, returnDonorId: donorId }) : ''}</li>`).join('')}</ul>` : empty('No recognition credits from other donors’ gifts.')
 const linkedTributes = depth.tributes.filter(t => t.gift_donor_id !== donorId)
 const matchList = depth.matches.length ? `<ul class="list">${depth.matches.map(m => {
  const actual = liveGifts.filter(g => g.donor_id === m.employer_donor_id && g.id !== m.gift_id && g.amount_cents >= m.amount_cents && g.received_on >= m.received_on)
  return `<li>${donorLink(m.employer_donor_id, m.employer_name)}: ${money(m.amount_cents)} expected for ${donorLink(m.gift_donor_id, m.gift_donor_name)}’s gift · due ${longDay(m.due_by)} ${chip(m.status, m.status === 'overdue' ? 'alarm' : m.status === 'received' ? 'ok' : '')}${m.status === 'received' ? `<br>Received ${money(m.received_amount_cents)} on ${longDay(m.matched_on)}` : ''}${staff && m.can_receive && m.status !== 'reversed' ? m.employer_donor_id === donorId ? actual.length ? form('match.receive', select('Received employer gift', 'giftId', actual.map(g => [g.id, giftLabel(g)] as [string, string]), '', 'required'), 'Link received match', { matchId: m.id, returnDonorId: donorId }) : '<p class="muted">Record the employer’s received gift above, then link it here.</p>' : `<p>Open ${donorLink(m.employer_donor_id, m.employer_name)} to record and link the employer’s received gift.</p>` : ''}</li>`
 }).join('')}</ul>` : empty('No employer matches recorded.')
 const corrections = staff && depth.softCredits.length ? `<details class="edit"><summary>Remove recognition from these gifts</summary>${depth.softCredits.map(s => form('softCredit.remove', `<p>${e(s.credited_donor_name)} · ${money(s.recognized_cents)} on ${longDay(s.received_on)}</p>`, 'Remove recognition', { softCreditId: s.id, returnDonorId: donorId })).join('')}</details>` : ''
 const forms = staff && liveGifts.length ? `<details class="edit"><summary>Credit another donor</summary><p>Recognition gives another donor credit for a gift. It does not add money received or create a tax receipt.</p>${others.length ? form('softCredit.record', `<div class="fields">${giftSelect()}${select('Recognized donor', 'donorId', [['', 'Choose a donor'], ...others], '', 'required')}${amountField('Recognition amount (USD)')}</div>`, 'Record recognition', { returnDonorId: donorId }) : '<p>Add another donor first.</p>'}</details>
 <details class="edit"><summary>Record a tribute</summary><p>The tribute appears on the donor’s receipt. Notification contact details are saved for staff; this form does not send a notification. Record the tribute before preparing a receipt.</p>${form('tribute.record', `<div class="fields">${giftSelect()}${select('Tribute type', 'kind', [['honor', 'In honor of'], ['memory', 'In memory of']])}${field('Honoree name', 'honoree', 'text', '', 'required maxlength="200"')}${select('Link honoree donor (optional)', 'donorId', [['', 'No donor link'], ...donorOptions(donors)])}${field('Notified person name (optional)', 'notifiedName', 'text', '', 'maxlength="200"')}${field('Notified person email (optional)', 'notifiedEmail', 'email')}</div>`, 'Save tribute', { returnDonorId: donorId })}</details>
 <details class="edit"><summary>Expect an employer match</summary><p>An expected match is separate from received gifts. Record the employer’s gift when the money arrives, then link it from the employer’s donor record.</p>${others.length ? form('match.record', `<div class="fields">${giftSelect()}${select('Employer donor', 'employerDonorId', [['', 'Choose an employer donor'], ...others], '', 'required')}${amountField('Expected match amount (USD)')}${field('Due by', 'dueBy', 'date', '', 'required')}</div>`, 'Record expected match', { returnDonorId: donorId }) : '<p>Add the employer as a donor first.</p>'}</details>` : ''
 return box('Gift recognition and matching', `<p><strong>${money(depth.recognitionCents)}</strong> recognition from other donors’ gifts. This is separate from this donor’s giving total and organization income.</p>${creditList}${corrections}${linkedTributes.length ? `<h3>Tributes for this donor</h3><ul class="list">${linkedTributes.map(t => `<li>In ${t.kind === 'memory' ? 'memory' : 'honor'} of ${e(t.honoree)} · ${longDay(t.received_on)}${t.active ? '' : ' · gift reversed'}</li>`).join('')}</ul>` : ''}<h3>Employer matches</h3>${matchList}${forms}`)
}
