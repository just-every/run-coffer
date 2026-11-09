import type { Row } from '../db'

const text = { type: 'string' }, integer = { type: 'integer' }, number = { type: 'number' }, boolean = { type: 'boolean' }
const nullable = (value: Row) => ({ anyOf: [value, { type: 'null' }] })
const strings = { type: 'array', items: text }
const array = (items: Row) => ({ type: 'array', items })
const object = (properties: Row, required = Object.keys(properties), additionalProperties: boolean | Row = false) => ({ type: 'object', properties, required, additionalProperties })
// Native SQL projections preserve extension columns. Those columns are scalar,
// not arbitrary opaque objects; computed structures have their own schemas below.
const scalar = { type: ['string', 'number', 'null'] }
const row = (properties: Row = {}, required = Object.keys(properties)) => object(properties, required, scalar)
const rows = (properties: Row = {}, required = Object.keys(properties)) => array(row(properties, required))
const money = { type: 'integer', description: 'Exact signed cents, never a floating dollar amount.' }
const count = { type: 'integer', minimum: 0 }
const id = { type: 'string', minLength: 1 }, version = { type: 'integer', minimum: 0 }
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const totals = object({ lifetimeCents: money, byYear: array(object({ year: text, cents: money })) })
const consent = row({ id: integer, donor_id: id, channel: text, status: text, captured_on: text })
const donor = row({ id, version, name: text, email: nullable(text), phone: nullable(text), address_line1: nullable(text), address_line2: nullable(text), city: nullable(text), region: nullable(text), postal_code: nullable(text), country: nullable(text) })
const gift = { id, donor_id: id, kind: text, amount_cents: money, received_on: text, goods: text, goods_cents: money }
const recognition = row({ anonymous: integer, wall_opt_in: integer, recognition_name: nullable(text) })
const acknowledgment = row({ status: text, link: nullable(row({ kind: text, id }, ['kind', 'id'])) }, ['status'])
const benefit = row({ limits: object({ maximumValueCents: money, minimumGiftCents: money, maximumCostCents: money }) }, [])
const fullGift = row({ ...gift, before_acknowledge_from: boolean, contribution_details: nullable(row()), receipt_benefit: benefit, acknowledgment, allocations: rows({ gift_id: id, fund: text, amount_cents: money }), recognition }, Object.keys(gift))
const summaryDonor = { id, version, name: text, email: nullable(text), city: nullable(text), region: nullable(text), total_cents: money }
const list = (item: Row) => object({ donors: array(item), more: boolean, page: count, q: text, total: count })

export const donorListOutput = {
 type: 'object',
 description: 'The native donor page. Preparation keys include household and consent summaries; named keys receive only their approved donor projection. total counts the accessible population before search.',
 anyOf: [list(object({ ...summaryDonor, source: text, erased_at: nullable(text), household: nullable(text), last_gift: nullable(text), email_consent: nullable(text), mail_consent: nullable(text) })), list(object(summaryDonor))],
}

const scopedContext = object({ donor, gifts: rows(gift), totals: object({ lifetimeCents: money }), scope: text })
const relationships = rows({ id, donor_id: id, related_donor_id: id, type: text, direction: text, label: text }, ['id', 'type', 'direction', 'label'])
const interactions = rows({ id, donor_id: id, kind: text, occurred_on: text })
const solicitationRow = row({ donor_id: id, version, type: text, channels: strings, active: boolean }, ['donor_id', 'version', 'type', 'channels', 'active'])
const solicitation = row({ ...solicitationRow.properties, asOf: text, lastAskOn: nullable(text), scope_version: version, inherited: array(solicitationRow) })
const weighted = { points: number, weight: number, basePoints: number }
const points = row(weighted)
const engagement = object({ score: number, asOf: text, policyVersion: version,
 recency: row({ ...points.properties, lastOn: nullable(text), days: nullable(integer) }),
 frequency: points, amount: points, conversations: points, volunteering: points,
 attendance: row({ ...points.properties, events: rows() }, ['points', 'weight', 'basePoints']),
 opens: row({ ...points.properties, events: rows() }, ['points', 'weight', 'basePoints']),
 retentionRisk: row({ flag: boolean, status: text, lastGiftOn: nullable(text), days: nullable(integer), reason: text }),
})
const summaryGift = object({ id, receivedOn: text, amountCents: money, originalAmountCents: money, fund: text })
const summary = object({
 lifetimeCents: money, firstGift: nullable(summaryGift), largestGift: nullable(summaryGift), lastGift: nullable(summaryGift), giftCount: count, consecutiveGivingYears: count,
 recurring: array(object({ id, status: text, amountCents: money, cancelAtPeriodEnd: boolean, interval: nullable(text), intervalCount: nullable(integer), collectionsPaused: boolean })),
 openPledgeCents: money, softCreditCents: money,
 fiscalYear: object({ start: text, end: text, previousStart: text, asOf: text, startMonthDay: text, currentCents: money, previousCents: money }),
})
const pledge = row({ id, donor_id: id, installments: rows(), adjustments: rows(), plan: nullable(row()), allocations: rows() }, ['id', 'donor_id', 'installments', 'adjustments', 'plan', 'allocations'])
const formReminder = row({ form: text, status: text, source: text, message: text, copyToDonor: boolean }, ['form', 'status', 'source', 'message'])
const inKindGift = row({ id, corrections: array(row({ snapshot: row() }, ['snapshot'])), reminders: object({ form8283: nullable(formReminder), form8282: nullable(formReminder), disposalWindowEndsOn: text }), acknowledgments: rows({ current: boolean }, ['current']) }, ['id', 'corrections', 'reminders', 'acknowledgments'])
const credit = row({ active: integer, acknowledgment: row({ link: nullable(row()) }, ['link']) }, ['active', 'acknowledgment'])
const fullContext = object({
 donor, gifts: array(fullGift), totals,
 household: rows({ id, name: text, erased_at: nullable(text) }), pledges: array(pledge), consents: array(consent),
 letters: rows({ id, batch_id: id, gift_id: nullable(id), amount_cents: money }), appeals: rows({ id, name: text, channel: text, status: text }), events: rows({ id: integer, action: text, subject_kind: text }),
 auctions: rows(), customValues: rows(), contactPoints: rows({ id, donor_id: id, kind: text, value: text }), contactHistory: rows(),
 contributionTypes: object({ monetary: rows(), stocks: rows({ valuationBasis: text, monetaryCents: money }) }),
 ruleTags: rows({ donor_id: id, tag: text, created_at: text }), solicitation, smsPreferences: rows(),
 names: object({ informal: text, formal: text, envelope: text }), organization: object({ contacts: rows(), organizations: rows(), relatedGifts: rows() }),
 tributeNotifications: rows(), receiptTasks: rows(), recognition: row({ donor_id: id, anonymous: integer, recognition_name: nullable(text), honor_roll_opt_in: integer, version }),
 timelineSources: rows({ kind: text }, ['kind']), engagement: nullable(engagement),
 communications: rows(), journeys: rows(), welcome: nullable(row()), marketingPreference: nullable(row()), subscriptions: rows(), summary,
 volunteering: object({ rows: rows({ id, donor_id: id, minutes: integer, hours: number }), years: array(object({ donorId: id, name: text, year: text, minutes: integer, hours: number })), minutes: integer }),
 inKind: object({ gifts: array(inKindGift), totalStatedValueCents: money }),
 depth: object({ relationships, interactions }),
 giftDepth: object({ softCredits: array(credit), creditedGifts: array(credit), recognitionCents: money, tributes: rows(), matches: rows() }),
 plannedGiving: object({ availableGifts: rows(), intentions: rows(), distributions: rows(), memberships: rows(), legacyMember: boolean }),
 notes: rows({ id, donor_id: id, body: text, confidential: integer }), firstGift: nullable(row({ id, donor_id: id, amount_cents: money })),
 current: object({ email: nullable(consent), mail: nullable(consent) }),
})

export const donorContextOutput = {
 type: 'object',
 description: 'The unchanged native donor history for preparation keys, or the deliberately smaller explicit-donor facts for named grants. Native row extension columns retain their scalar types. Neither schema grants access to a field.',
 anyOf: [fullContext, scopedContext],
}
export const acknowledgmentOutput = object({
 id, version: { type: 'integer', minimum: 1 }, letters: count, totalCents: money, contentHash: hash,
 onePiecePer: { type: 'string', enum: ['gift', 'constituent', 'household'] }, pieceCount: count, estimatedPostageCents: nullable(money),
})
export const appealOutput = object({
 id, code: text, costCents: money, version: { type: 'integer', minimum: 1 }, recipients: count, pieceCount: count,
 excluded: { type: 'object', additionalProperties: count }, contentHash: hash,
}, ['id', 'code', 'costCents', 'version', 'recipients', 'excluded', 'contentHash'])
export const receiptSendOutput = object({
 id, version: { type: 'integer', minimum: 1 }, remaining: count, submitted: count, delivered: count, print: count, bounced: count, suppressedInLocal: { const: true },
}, ['id', 'version', 'remaining', 'submitted', 'delivered', 'print', 'bounced'])
