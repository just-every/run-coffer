import { all, type Context } from '../db'
import { donorDepth, INTERACTION_TYPES, RELATIONSHIP_LABELS, RELATIONSHIP_TYPES, type DonorDepth, type DonorInteraction } from '../donor-depth'
import { area, box, e, empty, field, form, longDay, select, when } from './common'

type History = { donor: { id: string; name: string; erased_at?: string | null } } & Partial<DonorDepth>

/** Uses the donor record's existing cards/forms. Supplying depth data avoids a
 * second read when donorHistory already includes it. The caller can place the
 * two cards separately and reuse interactionItem in a combined gift timeline.
 */
export async function donorDepthPanels(c: Context, h: History, day: string, staff: boolean) {
 const d = h.donor
 if (d.erased_at) return { relationships: '', conversations: '' }
 const [depth, candidates] = await Promise.all([
  h.relationships && h.interactions ? Promise.resolve({ relationships: h.relationships, interactions: h.interactions }) : donorDepth(c, d.id),
  staff ? all<{ id: string; name: string; email: string | null }>(c, 'SELECT id,name,email FROM cf_donors WHERE erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id) AND id<>? ORDER BY lower(name),id', d.id) : Promise.resolve([]),
 ])
 const links = depth.relationships.length ? `<ul class="list">${depth.relationships.map(r => `<li>${e(r.label)} · <a href="/app/donors/${e(r.other_donor_id)}">${e(r.other_name)}</a>${staff ? `<details class="edit"><summary>Remove relationship</summary>${form('relationship.remove', `<p>Remove this link from both donor records?</p>`, 'Remove relationship', { donorId: d.id, relationshipId: r.id })}</details>` : ''}</li>`).join('')}</ul>` : empty('No relationships recorded.')
 const create = staff && candidates.length ? `<details class="edit"><summary>Add relationship</summary>${form('relationship.create', `<p>${e(d.name)}…</p><div class="fields">${select('Relationship', 'type', RELATIONSHIP_TYPES.map(t => [t, RELATIONSHIP_LABELS[t].sentence] as [string, string]))}${select('Related donor', 'relatedDonorId', [['', 'Choose a donor'], ...candidates.map(x => [x.id, `${x.name}${x.email ? ` · ${x.email}` : ''}`] as [string, string])], '', 'required')}</div>`, 'Add relationship', { donorId: d.id })}</details>` : staff ? '<p class="muted">Add another donor record to link a relationship.</p>' : ''
 const record = staff ? `<details class="edit"><summary>Record a conversation</summary>${interactionForm(d.id, c.actor.name, day)}</details>` : ''
 return {
  relationships: box('Relationships', links + create, 'relationships'),
  conversations: box('Conversations', `${record}<p class="muted">Calls, meetings and emails appear alongside gifts in the timeline.</p>`, 'conversations'),
 }
}

export function interactionForm(donorId: string, actorName: string, day: string) {
 return form('interaction.record', `<div class="fields">${select('Conversation type', 'kind', INTERACTION_TYPES.map(k => [k, k[0].toUpperCase() + k.slice(1)] as [string, string]))}${field('Date', 'occurredOn', 'date', day, `required max="${e(day)}"`)}${field('Who took part', 'who', 'text', actorName, 'required maxlength="500"')}</div>${area('Notes', 'notes', '', 'required maxlength="8000"')}${area('Next step', 'nextStep', '', 'maxlength="2000"')}`, 'Record conversation', { donorId })
}

/** A complete list item, also suitable for a mixed gift/conversation list. */
export function interactionItem(i: DonorInteraction, tz: string) {
 return `<li>${e(i.kind[0].toUpperCase() + i.kind.slice(1))} · ${longDay(i.occurred_on)}<p><strong>Who:</strong> ${e(i.who)}</p><p>${e(i.notes).replace(/\n/g, '<br>')}</p>${i.next_step ? `<p><strong>Next step:</strong> ${e(i.next_step).replace(/\n/g, '<br>')}</p>` : ''}<span class="muted">Recorded by ${e(i.recorded_by)} · ${when(i.recorded_at, tz)}</span></li>`
}
