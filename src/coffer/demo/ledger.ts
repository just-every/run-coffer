// Turns the sample people into Coffer rows dated relative to the demo's start:
// donors and households, a year of gifts (monthly card gifts from the Stripe
// move-in, checks, cash, grants, in-kind, dinner tickets with goods provided),
// two reversals, pledges with payments and each donor's consent history.
// Ids are fixed, so a second run writes nothing new.
import { addDays, type Row } from '../db'
import { donorId as stripeDonorId, giftId as stripeGiftId } from '../imports/snapshots'
import { donors, team, type DonorSeed } from './people'

export type Clock = { today: string; now: number }
export type Person = { id: string; name: string; role: string }
export type Staff = { owner: Person; marcus: Person; june: Person }
export type AuditEvent = { at: string; actor: Person; action: string; subject_kind: string; subject_id: string; donor_id: string | null; detail: Row }

export const dayOf = (clock: Clock, daysAgo: number) => addDays(clock.today, -daysAgo)
/** A working-hours time (America/New_York) `daysAgo`, never later than now. */
export const timeOf = (clock: Clock, daysAgo: number, hour = 10) =>
 new Date(Math.min(Date.parse(`${dayOf(clock, daysAgo)}T00:00:00Z`) + (hour + 4) * 3600000, clock.now - (60 - Math.min(daysAgo, 59)) * 60000)).toISOString()
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const donorIdOf = (d: DonorSeed) => d.monthly ? stripeDonorId(d.monthly.customer) : `demo-donor-${d.key}`

const CONSENT_TEXT = {
 email: [['web form', 'Ticked “Send me pantry news” on the online gift form'], ['event sign-up', 'Signed up at the Harvest Supper welcome table'], ['email reply', 'Replied “yes, please” to the volunteer newsletter invitation'], ['paper form', 'Ticked the email box on the holiday giving card, filed in the office']],
 mail: [['paper form', 'Returned the reply card from the spring mailing'], ['verbal', 'Asked by phone to stay on the mailing list; call logged by June'], ['paper form', 'Ticked “Mail me updates” on the gift slip']],
 withdrawn: { email: ['email reply', 'Asked to stop appeal emails in a reply to the spring appeal'], mail: ['verbal', 'Asked at the pantry desk not to receive mailings'] },
 declined: ['paper form', 'Left the updates box unticked on the gift card'],
} as const

export function ledger(clock: Clock, staff: Staff) {
 const households = new Map<string, Row>(), donorRows: Row[] = [], pledgeRows: Row[] = [], giftRows: Row[] = [], consentRows: Row[] = [], events: AuditEvent[] = []
 const event = (at: string, actor: Person, action: string, kind: string, id: string, donorId: string | null, detail: Row = {}) => events.push({ at, actor, action, subject_kind: kind, subject_id: id, donor_id: donorId, detail })
 const pledgeIds = new Map<string, string>()
 donors.forEach((d, n) => {
  const id = donorIdOf(d), joined = timeOf(clock, d.since, 9 + n % 7), entered = n % 3 === 0 ? staff.owner : staff.june
  if (d.household && !households.has(d.household)) households.set(d.household, { id: `demo-household-${slug(d.household)}`, name: d.household, created_at: joined })
  donorRows.push({ id, version: 1, name: d.name, email: d.email ?? null, phone: d.phone ?? null, address_line1: d.street ?? null, address_line2: null, city: d.city ?? null, region: d.city ? 'OH' : null, postal_code: d.zip ?? null,
   country: d.city ? (d.monthly ? 'US' : 'United States') : null, household_id: d.household ? households.get(d.household)!.id : null, source: d.monthly ? 'stripe' : 'manual', source_ref: d.monthly?.customer ?? null, created_at: joined, erased_at: null })
  if (!d.monthly) event(joined, entered, 'donor.create', 'donor', id, id)
  for (const p of d.pledges ?? []) {
   const pledgeId = `demo-pledge-${p.key}`, at = timeOf(clock, p.pledged, 14)
   pledgeIds.set(p.key, pledgeId)
   pledgeRows.push({ id: pledgeId, donor_id: id, amount_cents: p.dollars * 100, pledged_on: dayOf(clock, p.pledged), due_by: addDays(dayOf(clock, p.pledged), p.dueIn), fund: p.fund, created_at: at, created_by: staff.owner.name })
   event(at, staff.owner, 'pledge.create', 'pledge', pledgeId, id, { amountCents: p.dollars * 100 })
  }
  ;(d.gifts ?? []).forEach(([ago, dollars, x = {}], g) => {
   const giftId = x.stripe ? stripeGiftId(x.ref!) : `demo-gift-${d.key}-${g + 1}`, cents = dollars * 100, received = dayOf(clock, ago)
   const recorder = x.method === 'other' ? staff.marcus : x.method === 'online' || x.method === 'bank transfer' ? staff.owner : staff.june
   const at = x.stripe ? timeOf(clock, ago, 11) : timeOf(clock, Math.max(0, ago - 1), 15)
   giftRows.push({ id: giftId, version: 1, donor_id: id, kind: 'gift', reverses: null, received_on: received, amount_cents: cents, method: x.method ?? 'check', reference: x.ref ?? null, fund: x.fund ?? 'Unrestricted',
    pledge_id: x.pledge ? pledgeIds.get(x.pledge)! : null, goods: x.stripe ? 'unknown' : x.goods ? 'provided' : 'none', goods_cents: x.goods?.[0] ?? 0, goods_description: x.goods?.[1] ?? null, note: x.note ?? null,
    source: x.stripe ? 'stripe' : 'manual', created_at: at, created_by: x.stripe ? 'Stripe move-in' : recorder.name })
   if (!x.stripe) event(at, recorder, 'gift.record', 'gift', giftId, id, { amountCents: cents, receivedOn: received })
   if (x.reversed) {
    const [back, reason] = x.reversed, reversalId = `${giftId}-reversal`, when = timeOf(clock, back, 16)
    giftRows.push({ id: reversalId, version: 1, donor_id: id, kind: 'reversal', reverses: giftId, received_on: dayOf(clock, back), amount_cents: -cents, method: x.method ?? 'check', reference: null, fund: x.fund ?? 'Unrestricted',
     pledge_id: null, goods: 'none', goods_cents: 0, goods_description: null, note: reason, source: 'manual', created_at: when, created_by: staff.marcus.name })
    event(when, staff.marcus, 'gift.reverse', 'gift', giftId, id, { amountCents: -cents, reversal: reversalId })
   }
  })
  if (d.monthly) {
   const m = d.monthly, [year, month] = clock.today.split('-').map(Number)
   let charges = 0
   for (let back = 0; charges < m.months; back++) {
    const first = new Date(Date.UTC(year, month - 1 - back, 1)), day = `${first.toISOString().slice(0, 8)}${String(m.day).padStart(2, '0')}`
    if (day > clock.today) continue
    const charge = `ch_3Q${m.customer.slice(-6)}${day.replaceAll('-', '')}`, ago = Math.round((Date.parse(`${clock.today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000)
    giftRows.push({ id: stripeGiftId(charge), version: 1, donor_id: id, kind: 'gift', reverses: null, received_on: day, amount_cents: m.dollars * 100, method: 'card', reference: charge, fund: 'Unrestricted',
     pledge_id: null, goods: 'none', goods_cents: 0, goods_description: null, note: 'Monthly gift', source: 'stripe', created_at: timeOf(clock, ago, 6), created_by: 'Stripe move-in' })
    charges++
   }
  }
  consents(clock, staff, d, id, n, consentRows, event)
 })
 return { households: [...households.values()], donors: donorRows, pledges: pledgeRows, gifts: giftRows, consents: consentRows, events }
}

type Emit = (at: string, actor: Person, action: string, kind: string, id: string, donorId: string | null, detail?: Row) => void
function consents(clock: Clock, staff: Staff, d: DonorSeed, donorId: string, n: number, rows: Row[], event: Emit) {
 const add = (channel: 'email' | 'mail', status: 'granted' | 'withdrawn', [method, evidence]: readonly [string, string], ago: number) => {
  const at = timeOf(clock, ago, 11), by = n % 4 === 1 ? staff.owner : staff.june
  rows.push({ donor_id: donorId, channel, status, method, evidence, captured_on: dayOf(clock, ago), recorded_at: at, recorded_by: by.name })
  event(at, by, 'consent.record', 'donor', donorId, donorId, { channel, status, method })
 }
 for (const channel of ['email', 'mail'] as const) {
  const answer = channel === 'email' ? d.email_consent : d.mail_consent, first = Math.max(1, d.since - 2 - (channel === 'mail' ? 1 : 0))
  if (!answer) continue
  if (answer === 'no') { add(channel, 'withdrawn', CONSENT_TEXT.declined, first); continue }
  const options = CONSENT_TEXT[channel]
  add(channel, 'granted', options[n % options.length], first)
  if (answer === 'withdrawn') add(channel, 'withdrawn', CONSENT_TEXT.withdrawn[channel], Math.max(1, Math.floor(d.since / 3)))
 }
}

/** The team's sign-in accounts, active, so "Sign in as" works for each. */
export const teamRows = (clock: Clock) => team.map(t => ({ id: t.id, email: t.email, display_name: t.name, role: t.role, status: 'active', version: 1, created_at: Date.parse(timeOf(clock, t.joined, 10)) }))
