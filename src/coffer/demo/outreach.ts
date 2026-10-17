// Acknowledgement letters and appeals at every stage, frozen exactly as Coffer
// freezes them: letters rendered from the reviewed wording with renderLetter and
// hashed with letterHash, audiences chosen by audience() with each recipient's
// consent row and hashed with hashOf. A visitor can approve, export and record
// the waiting ones, and the content checks pass.
import { address, letterHash, lettersCsv } from '../acknowledgements'
import { audience, hashOf, recipientsCsv } from '../appeals'
import { sha256, type Row } from '../db'
import { renderLetter, type Settings } from '../settings'
import { dayOf, timeOf, type AuditEvent, type Clock, type Person, type Staff } from './ledger'

type Stage = { status: 'prepared' | 'approved' | 'exported' | 'sent'; prepared: number; by: Person; approver?: Person; sent?: number; method?: string }

/** Letter batches: monthly sent batches, last month's exported one, the agent's
 * batch waiting for approval; the newest gifts are still due. */
export function letterPlan(staff: Staff, agents: { spring: Person; fall: Person }): ((ago: number) => { key: string; stage: Stage } | null) {
 return ago => {
  if (ago < 9) return null
  if (ago < 25) return { key: 'agent-fall', stage: { status: 'prepared', prepared: 8, by: agents.fall } }
  if (ago < 55) return { key: 'last-month', stage: { status: 'exported', prepared: 23, by: staff.owner, approver: staff.owner } }
  const k = Math.floor((ago - 55) / 30), start = 55 + 30 * k
  return { key: `month-${k}`, stage: { status: 'sent', prepared: start - 2, by: k === 0 ? agents.spring : k % 2 ? staff.marcus : staff.owner, approver: k % 2 ? staff.owner : staff.marcus, sent: start - 4, method: k % 3 === 2 ? 'mail and email' : 'mail' } }
 }
}

export async function letters(clock: Clock, s: Settings, gifts: Row[], donors: Map<string, Row>, plan: ReturnType<typeof letterPlan>) {
 const ago = (day: string) => Math.round((Date.parse(`${clock.today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000)
 const reversed = new Set(gifts.filter(g => g.kind === 'reversal').map(g => g.reverses))
 const groups = new Map<string, { stage: Stage; gifts: Row[] }>()
 for (const g of gifts.filter(g => g.kind === 'gift' && g.amount_cents >= s.threshold_cents && g.goods !== 'unknown' && !reversed.has(g.id)).sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id))) {
  const slot = plan(ago(g.received_on))
  if (!slot) continue
  if (!groups.has(slot.key)) groups.set(slot.key, { stage: slot.stage, gifts: [] })
  groups.get(slot.key)!.gifts.push(g)
 }
 const batches: Row[] = [], acks: Row[] = [], approvals: Row[] = [], events: AuditEvent[] = []
 for (const [key, { stage, gifts: chosen }] of groups) {
  const batchId = `demo-batch-${key}`, preparedAt = timeOf(clock, stage.prepared, 9), day = dayOf(clock, stage.prepared)
  const rows = chosen.map((g, position) => {
   const d = donors.get(g.donor_id)!, rendered = renderLetter(s, g, d.name, day)
   return { id: `demo-ack-${key}-${position + 1}`, batch_id: batchId, position, gift_id: g.id, donor_id: d.id, live: 1, recipient_name: d.name, recipient_email: d.email, address: address(d), subject: rendered.subject, body: rendered.body, amount_cents: g.amount_cents, received_on: g.received_on }
  })
  const hash = await letterHash(s.version, rows), total = rows.reduce((n, l) => n + l.amount_cents, 0)
  const decided = stage.approver ? timeOf(clock, stage.prepared - 1, 10) : null, exported = stage.status === 'exported' || stage.status === 'sent' ? timeOf(clock, stage.prepared - 1, 11) : null
  batches.push({ id: batchId, version: { prepared: 1, approved: 2, exported: 3, sent: 4 }[stage.status], status: stage.status, content_hash: hash, letters: rows.length, total_cents: total, settings_version: s.version,
   prepared_by_id: stage.by.id, prepared_by_name: stage.by.name, prepared_by_role: stage.by.role, prepared_at: preparedAt,
   export_hash: exported ? await sha256(lettersCsv(rows)) : null, exported_at: exported, exported_by: exported ? stage.approver!.name : null,
   sent_on: stage.sent !== undefined ? dayOf(clock, stage.sent) : null, sent_method: stage.method ?? null, sent_recorded_by: stage.sent !== undefined ? staff(stage).name : null, discarded_at: null })
  acks.push(...rows)
  events.push({ at: preparedAt, actor: stage.by, action: 'ack.prepare', subject_kind: 'acknowledgements', subject_id: batchId, donor_id: null, detail: { letters: rows.length, totalCents: total } })
  if (decided) {
   approvals.push(approval('acknowledgements', batchId, hash, stage, decided))
   events.push({ at: decided, actor: stage.approver!, action: 'ack.approve', subject_kind: 'acknowledgements', subject_id: batchId, donor_id: null, detail: { letters: rows.length, preparedBy: stage.by.role } })
  }
  if (exported) events.push({ at: exported, actor: stage.approver!, action: 'ack.export', subject_kind: 'acknowledgements', subject_id: batchId, donor_id: null, detail: { letters: rows.length } })
  if (stage.sent !== undefined) events.push({ at: timeOf(clock, stage.sent, 16), actor: staff(stage), action: 'ack.markSent', subject_kind: 'acknowledgements', subject_id: batchId, donor_id: null, detail: { sentOn: dayOf(clock, stage.sent), method: stage.method } })
 }
 return { batches, acks, approvals, events }
}
const staff = (stage: Stage) => stage.approver ?? stage.by
const approval = (kind: string, subjectId: string, hash: string, stage: Stage, at: string) => ({ id: `demo-approval-${subjectId}`, subject_kind: kind, subject_id: subjectId, content_hash: hash,
 prepared_by_id: stage.by.id, prepared_by_name: stage.by.name, prepared_by_role: stage.by.role, approved_by_id: stage.approver!.id, approved_by_name: stage.approver!.name, approved_by_role: stage.approver!.role, approved_at: at })

type AppealSeed = { key: string; name: string; channel: 'email' | 'mail'; givenSince?: number; minTotalCents?: number; stage: Stage }
export const appealPlan = (s: Staff, agents: { fall: Person }): AppealSeed[] => [
 { key: 'spring-backpacks', name: 'Spring Backpack Appeal', channel: 'email', stage: { status: 'sent', prepared: 196, by: s.owner, approver: s.marcus, sent: 194 } },
 { key: 'summer-mobile-pantry', name: 'Summer Mobile Pantry Letter', channel: 'mail', stage: { status: 'sent', prepared: 126, by: s.marcus, approver: s.owner, sent: 121 } },
 { key: 'thanksgiving-meals', name: 'Thanksgiving Meals Appeal', channel: 'mail', givenSince: 365, minTotalCents: 10000, stage: { status: 'approved', prepared: 6, by: s.owner, approver: s.marcus } },
 { key: 'giving-tuesday', name: 'Giving Tuesday Email', channel: 'email', stage: { status: 'prepared', prepared: 1, by: agents.fall } },
]

export async function appeals(clock: Clock, db: D1Database, plan: AppealSeed[], since: Map<string, number>) {
 const rows: Row[] = [], recipients: Row[] = [], approvals: Row[] = [], events: AuditEvent[] = []
 for (const a of plan) {
  const appealId = `demo-appeal-${a.key}`, segment = { givenSince: a.givenSince ? dayOf(clock, a.givenSince) : null, minTotalCents: a.minTotalCents ?? 0 }, stage = a.stage
  const found = await audience({ db }, a.channel, segment)
  // Past appeals went only to people who were already donors then.
  const list = found.recipients.filter(r => (since.get(r.donor_id) ?? 0) > stage.prepared)
  const hash = await hashOf(a.name, a.channel, list), preparedAt = timeOf(clock, stage.prepared, 10)
  const decided = stage.approver ? timeOf(clock, stage.prepared - 1, 11) : null, exported = stage.status === 'sent' ? timeOf(clock, stage.prepared - 1, 12) : null
  rows.push({ id: appealId, version: { prepared: 1, approved: 2, exported: 3, sent: 4 }[stage.status], name: a.name, channel: a.channel, segment: JSON.stringify(segment), excluded: JSON.stringify(found.excluded), status: stage.status,
   content_hash: hash, recipients: list.length, prepared_by_id: stage.by.id, prepared_by_name: stage.by.name, prepared_by_role: stage.by.role, prepared_at: preparedAt,
   export_hash: exported ? await sha256(recipientsCsv({ channel: a.channel }, list)) : null, exported_at: exported, exported_by: exported ? stage.approver!.name : null,
   sent_on: stage.sent !== undefined ? dayOf(clock, stage.sent) : null, sent_recorded_by: stage.sent !== undefined ? stage.approver!.name : null, discarded_at: null })
  recipients.push(...list.map(r => ({ appeal_id: appealId, ...r })))
  events.push({ at: preparedAt, actor: stage.by, action: 'appeal.prepare', subject_kind: 'appeal', subject_id: appealId, donor_id: null, detail: { channel: a.channel, recipients: list.length, excluded: found.excluded } })
  if (decided) {
   approvals.push(approval('appeal', appealId, hash, stage, decided))
   events.push({ at: decided, actor: stage.approver!, action: 'appeal.approve', subject_kind: 'appeal', subject_id: appealId, donor_id: null, detail: { recipients: list.length, preparedBy: stage.by.role } })
  }
  if (exported) events.push({ at: exported, actor: stage.approver!, action: 'appeal.export', subject_kind: 'appeal', subject_id: appealId, donor_id: null, detail: { recipients: list.length } })
  if (stage.sent !== undefined) events.push({ at: timeOf(clock, stage.sent, 15), actor: stage.approver!, action: 'appeal.markSent', subject_kind: 'appeal', subject_id: appealId, donor_id: null, detail: { sentOn: dayOf(clock, stage.sent) } })
 }
 return { appeals: rows, recipients, approvals, events }
}
