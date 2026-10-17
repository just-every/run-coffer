// Online giving on the pantry's own campaign page, shaped exactly as Coffer's
// checkout records it (giving/recording.ts, giving/online-receipt.ts,
// agent/recovery.ts): the Holiday Meals campaign, one-off card gifts and monthly
// plans from donors already on file, each gift's automatic emailed receipt, and
// one monthly card Stripe declined and then cleared on retry, with the recovery
// worker's notes. Ids are fixed; nothing is fetched or sent.
import { address, letterHash } from '../acknowledgements'
import type { Row } from '../db'
import { renderLetter, type Settings } from '../settings'
import { dayOf, timeOf, type AuditEvent, type Clock } from './ledger'

type Plan = { key: string; dollars: number; started: number; declined?: number; cleared?: number }
const MONTHLY: Plan[] = [
 { key: 'jackson-t', dollars: 50, started: 64, declined: 4, cleared: 2 },
 { key: 'mbeki', dollars: 30, started: 58 },
 { key: 'osei', dollars: 20, started: 55 },
 { key: 'ruiz', dollars: 25, started: 40 },
]
const ONCE: { key: string; dollars: number; ago: number }[] = [
 { key: 'cohen', dollars: 180, ago: 20 }, { key: 'tran', dollars: 250, ago: 9 }, { key: 'moreau', dollars: 100, ago: 12 }, { key: 'singh', dollars: 75, ago: 6 }, { key: 'rahman', dollars: 60, ago: 1 },
]
const STRIPE = { id: 'stripe', name: 'Stripe', role: 'agent' }
const RECEIPTS = { id: 'online-receipts', name: 'Automatic online receipt', role: 'system' }
const at = (clock: Clock, daysAgo: number, hour: number, minute = 0) => new Date(Date.parse(timeOf(clock, daysAgo, hour)) + minute * 60000).toISOString()

export async function onlineGiving(clock: Clock, s: Settings, donors: Map<string, Row>) {
 const campaign = { id: 'demo-campaign-holiday', slug: 'holiday-meals', name: `Holiday Meals ${clock.today.slice(0, 4)}`, fund: 'Holiday Meals', goal_cents: 150000, active: 1, created_at: at(clock, 70, 9),
  description: 'Every $50 puts a holiday meal box on a family’s table: a turkey or ham, potatoes, green beans, stuffing and a pie, packed by volunteers and handed out the week before Thanksgiving.' }
 const customers: Row[] = [], intents: Row[] = [], plans: Row[] = [], gifts: Row[] = [], campaignGifts: Row[] = [], planGifts: Row[] = [], events: AuditEvent[] = []
 const donor = (key: string) => donors.get(`demo-donor-${key}`)!
 const give = (key: string, cents: number, ago: number, hour: number, minute: number, n: number, planId?: string) => {
  const d = donor(key), reference = `ch_demo${key.replace(/-/g, '')}${n}`, id = `giving-${reference}`, created = at(clock, ago, hour, minute)
  gifts.push({ id, version: 1, donor_id: d.id, kind: 'gift', reverses: null, received_on: dayOf(clock, ago), amount_cents: cents, method: 'card', reference, fund: campaign.fund, pledge_id: null, goods: 'none', goods_cents: 0, goods_description: null, note: null, source: 'stripe', created_at: created, created_by: 'Stripe' })
  campaignGifts.push({ gift_id: id, campaign_id: campaign.id })
  if (planId) planGifts.push({ gift_id: id, subscription_id: planId })
  events.push({ at: created, actor: STRIPE, action: 'giving.paid', subject_kind: 'gift', subject_id: id, donor_id: d.id, detail: { amountCents: cents, campaignId: campaign.id } })
 }
 const start = (key: string, cents: number, frequency: 'once' | 'monthly', ago: number) => {
  const d = donor(key), customer = `cus_Demo${key.replace(/-/g, '')}`
  customers.push({ customer_id: customer, donor_id: d.id })
  intents.push({ id: `demo-intent-${key}`, campaign_id: campaign.id, name: d.name, email: d.email, amount_cents: cents, frequency, customer_id: customer, session_id: `cs_demo_${key}`, donor_id: d.id, created_at: at(clock, ago, 19), email_consent: 0 })
  return customer
 }
 ONCE.forEach((g, i) => { start(g.key, g.dollars * 100, 'once', g.ago); give(g.key, g.dollars * 100, g.ago, 19, 12 + i, 1) })
 let recovery: Row | null = null, activity: Row[] = []
 for (const p of MONTHLY) {
  const customer = start(p.key, p.dollars * 100, 'monthly', p.started), planId = `sub_demo_${p.key.replace(/-/g, '')}`
  plans.push({ id: planId, donor_id: donor(p.key).id, campaign_id: campaign.id, customer_id: customer, amount_cents: p.dollars * 100, status: 'active', cancel_at_period_end: 0, failed_attempts: p.declined ? 1 : 0, recovered: p.declined ? 1 : 0, next_attempt_at: null, updated_at: at(clock, p.cleared ?? p.started, 8, 4) })
  for (let ago = p.started, n = 1; ago >= 0; ago -= 30, n++) {
   if (p.declined !== undefined && ago === p.declined) { give(p.key, p.dollars * 100, p.cleared!, 8, 4, n, planId); continue }
   give(p.key, p.dollars * 100, ago, 7, 30, n, planId)
  }
  if (p.declined === undefined) continue
  const invoice = `in_demo${p.key.replace(/-/g, '')}`, declined = at(clock, p.declined, 9, 16), cleared = at(clock, p.cleared!, 8, 4)
  recovery = { invoice_id: invoice, subscription_id: planId, state: 'recovered', attempt_count: 2, next_attempt_at: null, notice_state: 'sent', notice_event_id: `evt_demo${p.key.replace(/-/g, '')}`, notice_at: at(clock, p.declined, 9, 17), created_at: declined, last_checked_at: cleared }
  const recovering = { actor_id: 'coffer-recovery', actor_name: 'Coffer recovery', subject_id: invoice, undo_kind: null, undo_data: null, undone_at: null }
  activity = [
   { id: 'demo-activity-recovery-1', at: declined, kind: 'recovery.waiting', summary: 'Failed monthly gift is waiting on Stripe recovery.', why: 'Current Stripe invoice and subscription state: open; past_due. Stripe owns the retry schedule.', ...recovering },
   { id: 'demo-activity-recovery-2', at: at(clock, p.declined, 9, 17), kind: 'recovery.card_link_requested', summary: 'Requested one private card-update email.', why: 'The monthly invoice failed. Email cannot be unsent; an interrupted send needs review before any new invitation.', ...recovering },
   { id: 'demo-activity-recovery-3', at: at(clock, p.declined, 9, 17), kind: 'recovery.card_link_sent', summary: 'Private card-update email accepted by the mail provider.', why: 'The donor can update their card in the secure giving portal. This email cannot be unsent.', ...recovering },
   { id: 'demo-activity-recovery-4', at: cleared, kind: 'recovery.recovered', summary: 'Monthly gift recovered at Stripe; the paid gift is recorded.', why: 'Current Stripe invoice and subscription state: paid; active. Stripe owns the retry schedule.', ...recovering },
  ]
 }

 // Each online gift's automatic receipt, approved by the owner's online-receipts setting.
 const batches: Row[] = [], acks: Row[] = [], approvals: Row[] = []
 for (const g of gifts) {
  const d = donors.get(g.donor_id)!, batchId = `receipt-${g.id}`, sent = g.created_at, fresh = Date.parse(clock.today) - Date.parse(g.received_on) < 3 * 86400000
  const rendered = renderLetter(s, g, d.name, g.received_on)
  const letter = { id: batchId, batch_id: batchId, position: 0, gift_id: g.id, donor_id: d.id, live: 1, recipient_name: d.name, recipient_email: d.email, address: address(d), subject: rendered.subject, body: rendered.body, amount_cents: g.amount_cents, received_on: g.received_on,
   route: 'email', delivery_status: fresh ? 'submitted' : 'delivered', message_id: `demo-message-${g.id}`, submitted_at: sent, delivered_at: fresh ? null : new Date(Date.parse(sent) + 90000).toISOString() }
  const hash = await letterHash(s.version, [letter])
  batches.push({ id: batchId, version: 1, status: 'approved', content_hash: hash, letters: 1, total_cents: g.amount_cents, settings_version: s.version, prepared_by_id: RECEIPTS.id, prepared_by_name: RECEIPTS.name, prepared_by_role: RECEIPTS.role, prepared_at: sent,
   export_hash: null, exported_at: null, exported_by: null, sent_on: null, sent_method: null, sent_recorded_by: null, discarded_at: null })
  acks.push(letter)
  approvals.push({ id: `approval-${batchId}`, subject_kind: 'acknowledgements', subject_id: batchId, content_hash: hash, prepared_by_id: RECEIPTS.id, prepared_by_name: RECEIPTS.name, prepared_by_role: RECEIPTS.role, approved_by_id: RECEIPTS.id, approved_by_name: 'Online receipts setting', approved_by_role: 'owner setting', approved_at: sent })
 }
 return { campaign, customers, intents, plans, gifts, campaignGifts, planGifts, recovery, activity, batches, acks, approvals, events, recoveredAt: recovery?.last_checked_at ?? null }
}
