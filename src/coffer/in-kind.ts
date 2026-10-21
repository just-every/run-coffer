import { contributionReceiptKind, renderContributionReceipt, withContributionTypes } from './contribution-receipts'
import { recipientMergeFields } from './template-fields'
import { letterRecipient } from './organizations'
import { receiptText } from './receipt-format'
import { addDays, all, choice, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, today, type Context, type Row } from './db'
import { amount, usd } from './money'
import { fill, longDate, settings, type Settings } from './settings'
import { settingsUse, templateFor, templateRevision, templatesUnchanged, templateUse } from './letter-templates'

export const IN_KIND_GOODS = ['unknown', 'none', 'provided', 'intangible religious benefits'] as const
export const IN_KIND_FORM_8283 = ['unknown', 'section_b', 'not_section_b'] as const
export const IN_KIND_DISPOSALS = ['sold', 'exchanged', 'consumed', 'distributed', 'otherwise disposed'] as const
export const IN_KIND_EXCEPTIONS = ['none', 'donor-certified-500', 'charitable-use'] as const
export const IN_KIND_IRS = {
 acknowledgment: 'https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments',
 form8283: 'https://www.irs.gov/instructions/i8283',
 form8282: 'https://www.irs.gov/pub/irs-pdf/f8282.pdf',
}
const live = (donorId: string) => guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)', 'DONOR_CHANGED', 'Open the current donor before recording property.', donorId, donorId)
const current = (giftId: string, donorId: string, version: number) => guard('EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=? AND donor_id=? AND version=?)', 'VERSION', 'This property record changed. Refresh before saving.', giftId, donorId, version)
// Calendar years, including a leap-day receipt. The third anniversary is included;
// a disposal the following day is outside the IRS three-year reporting period.
const threeYearsAfter = (day: string) => {
 const year = Number(day.slice(0, 4)) + 3, candidate = `${year}${day.slice(4)}`
 return day.endsWith('-02-29') && new Date(`${candidate}T00:00:00Z`).getUTCMonth() !== 1 ? `${year}-02-28` : candidate
}

/** Reminders prompt a person to review the actual donor filing; internal value
 * alone cannot establish a deduction or the Section B filing requirement. */
export function inKindReminders(g: Row) {
 const form8283 = g.stated_value_cents > 500000 || g.form_8283 === 'section_b' ? {
  form: '8283', status: 'review', source: IN_KIND_IRS.form8283,
  message: 'The donor may need an authorized organization signature on Form 8283, Section B. The signature acknowledges receipt, not the appraised value. Check exceptions and groups of similar items with the donor.',
 } : null
 const withinThreeYears = !!g.disposed_on && g.disposed_on >= g.original_received_on && g.disposed_on <= threeYearsAfter(g.original_received_on)
 const exempt = g.disposal_exception && g.disposal_exception !== 'none'
 const form8282 = withinThreeYears ? {
  form: '8282', status: exempt ? 'exception recorded' : 'review', source: IN_KIND_IRS.form8282,
  dueOn: exempt ? null : addDays(g.became_aware_on || g.disposed_on, g.became_aware_on ? 60 : 125),
  copyToDonor: !exempt,
  message: exempt ? 'A filing exception was recorded. Retain the supporting evidence and review it against the Form 8282 instructions.' :
   'Review Form 8282: property was disposed of within three years of the original receipt. Filing generally applies to charitable deduction property with a claimed value over $5,000 per item or group; internal value alone does not establish applicability. If required, file with the IRS and give a copy to the original donor. The normal deadline is 125 days after disposition; when the organization had no reason to know the requirements applied and later learns they did, it is 60 days after becoming aware.',
 } : null
 return { form8283, form8282, disposalWindowEndsOn: threeYearsAfter(g.original_received_on) }
}

function renderAcknowledgment(s: Settings, g: Row, recipient: Row, on: string, template: Row | null) {
 if (contributionReceiptKind(g) === 'stock') return renderContributionReceipt(s, g, recipient, on, template)
 // Deliberately independent of monetary letter templates and stated value.
 const goods = g.goods === 'provided'
  ? `In exchange for this contribution, ${s.organisation} provided ${g.goods_description}, with a good faith estimated value of ${usd(g.goods_cents)}.`
  : g.goods === 'intangible religious benefits'
   ? 'The only goods or services provided in exchange for this contribution consisted entirely of intangible religious benefits.'
   : 'No goods or services were provided in exchange for this contribution.'
 if (template) {
  // RCPT-007: an in-kind template never merges a value; the property, quantity and goods facts stay.
  const fields = { ...recipientMergeFields(recipient), date: longDate(on), donor_name: recipient.letter_salutation, gift_date: longDate(g.received_on), description: g.description, quantity: String(g.quantity), goods_statement: goods, organization: s.organisation, ein: s.ein }
  return { subject: fill(template.subject, fields), body: fill(template.body, fields), ...templateUse(template, s) }
 }
 return {
  ...settingsUse(s),
  subject: `Property contribution acknowledgment from ${s.organisation}`,
  body: `${longDate(on)}\n\nDear ${recipient.letter_salutation},\n\n${s.organisation} acknowledges receipt on ${longDate(g.received_on)} of the following property:\n\n${g.description}\nQuantity: ${g.quantity}\n\n${goods}\n\n${s.organisation}\nEIN ${s.ein}`,
 }
}

export async function inKindCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['inKind.save', 'inKind.acknowledge', 'inKind.dispose'].includes(command)) return undefined
 const donorId = id(p.donorId, 'Donor'), s = await settings(c), day = today(s.timezone, new Date(c.now))
 if (command === 'inKind.save') {
  const giftId = p.inKindId ? id(p.inKindId, 'In-kind gift') : newId(), version = p.inKindId ? integer(p.version, 'Version', 1) : 0
  const existing=version?await one(c,'SELECT * FROM cf_in_kind_gifts WHERE id=? AND donor_id=?',giftId,donorId):null
  if(version&&!existing)fail('NOT_FOUND','That property record does not exist.',404)
  const fund=optional(p.fund,'Fund',100)??existing?.fund??'Unrestricted'
  const description = longText(p.description, 'Property description', 4000), quantity = String(p.quantity ?? '').trim()
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(quantity) || Number(quantity) <= 0) fail('INPUT', 'Quantity must be a positive number with at most six decimal places.', 400)
  const value = amount(p, 'statedValue', 'Donor-stated total value', { allowZero: true }), receivedOn = date(p.receivedOn, 'Property received on')
  const originalOn = p.originalReceivedOn ? date(p.originalReceivedOn, 'Original donee received on') : existing?.original_received_on??receivedOn
  if (receivedOn > day || originalOn > receivedOn) fail('INPUT', 'Receipt dates must be in the past or today; original receipt must be on or before this organization received the property.', 400)
  const goods = choice(p.goods, IN_KIND_GOODS, 'Goods or services'), goodsDescription = goods === 'provided' ? longText(p.goodsDescription, 'Goods or services description', 1000) : null
  if (goods === 'intangible religious benefits' && !s.religious_organization) fail('RELIGIOUS_ORGANIZATION', 'Review the exclusively religious organization setting before recording intangible religious benefits.', 409)
  const goodsCents = goods === 'provided' ? amount(p, 'goodsValue', 'Good faith value of goods or services', { allowZero: true }) : 0
  if(existing&&(receivedOn!==existing.received_on||originalOn!==existing.original_received_on||fund!==existing.fund))fail('PROPERTY_IMMUTABLE','Receipt dates and fund are immutable; a property correction keeps the original ledger facts.')
  const correctionReason=version?longText(p.correctionReason,'Reason for property correction',2000):null
  const snapshot=JSON.stringify({description,quantity,stated_value_cents:value,goods,goods_description:goodsDescription,goods_cents:goodsCents,form_8283:p.form8283??'unknown'})
  const form8283 = choice(p.form8283 ?? 'unknown', IN_KIND_FORM_8283, 'Form 8283 status')
  await commit(c, [live(donorId), ...(version ? [current(giftId, donorId, version),
   guard('NOT EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=? AND disposed_on IS NOT NULL)', 'PROPERTY_DISPOSED', 'Disposed property facts are frozen. Keep the disposition and its original receipt as recorded.', giftId),
   sql('INSERT INTO cf_in_kind_revisions VALUES(?,?,?,?,?,?,?)',newId(),giftId,existing!.property_version+1,snapshot,correctionReason,c.now,c.actor.id),
   sql('UPDATE cf_in_kind_gifts SET version=version+1,property_version=property_version+1,updated_at=? WHERE id=?',c.now,giftId)] :
   [sql(`INSERT INTO cf_in_kind_gifts(id,donor_id,description,quantity,stated_value_cents,received_on,original_received_on,goods,goods_description,goods_cents,form_8283,created_at,updated_at,created_by,fund) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, giftId, donorId, description, quantity, value, receivedOn, originalOn, goods, goodsDescription, goodsCents, form8283, c.now, c.now,c.actor.id,fund)]),
   event(c, command, 'inKindGift', giftId, donorId, { statedValueCents: value, version: version + 1 }),
  ])
  return { id: giftId, donorId, version: version + 1 }
 }
 const giftId = id(p.inKindId, 'In-kind gift'), version = integer(p.version, 'Version', 1)
 const g = await one(c, 'SELECT g.*,d.name AS donor_name FROM cf_in_kind_current g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND g.donor_id=? AND d.erased_at IS NULL', giftId, donorId)
 if (!g) fail('NOT_FOUND', 'That property record does not exist on this donor.', 404)
 await withContributionTypes(c, [g])
 if (command === 'inKind.acknowledge') {
  const on = date(p.acknowledgedOn, 'Acknowledgment date')
  if (on < g.received_on || on > day) fail('INPUT', 'Acknowledgment date must be on or after receipt and no later than today.', 400)
  if (!s.reviewed_at || !s.ein) fail('SETTINGS', 'Review the organization name and EIN in settings before issuing a property acknowledgment.')
  if (g.goods === 'unknown') fail('GOODS_UNKNOWN', 'Confirm goods or services before issuing a property acknowledgment.')
  const previous = await one(c, 'SELECT * FROM cf_in_kind_acknowledgments WHERE in_kind_id=? ORDER BY property_version DESC LIMIT 1', giftId)
  const correction = previous ? await one(c, 'SELECT reason FROM cf_in_kind_revisions WHERE in_kind_id=? AND property_version=?', giftId, g.property_version) : null
  const recipient=await letterRecipient(c,(await one(c,'SELECT * FROM cf_donors WHERE id=?',donorId))!)
  const acknowledgmentId = newId(), template = await templateFor(c, contributionReceiptKind(g) === 'stock' ? 'stock' : 'in_kind'), revision = await templateRevision(c), letter = renderAcknowledgment(s, g, recipient, on, template)
  if(recipient.constituent_kind==='organization')letter.body=[recipient.letter_name,...[recipient.address_line1,recipient.address_line2,[recipient.city,recipient.region,recipient.postal_code].filter(Boolean).join(' '),recipient.country].filter(Boolean),'',letter.body].join('\n')
  if (previous) letter.body = `Corrected property acknowledgment replacing ${previous.receipt_year}-${previous.receipt_sequence}. What changed: ${correction?.reason ?? 'Donor reassigned'}. Use this copy in place of the earlier acknowledgment.\n\n${letter.body}`
  await commit(c, [live(donorId), current(giftId, donorId, version),
   guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'SETTINGS_CHANGED', 'Settings changed. Refresh before issuing the acknowledgment.', s.version), templatesUnchanged(revision),
   guard('NOT EXISTS(SELECT 1 FROM cf_in_kind_acknowledgments WHERE in_kind_id=? AND property_version=?)', 'ALREADY_ACKNOWLEDGED', 'This property version already has an acknowledgment.', giftId, g.property_version),
   sql('INSERT INTO cf_in_kind_acknowledgments(id,in_kind_id,property_version,acknowledged_on,subject,body,created_by,created_at,template_kind,template_id,template_version,replaces_id,recipient_address) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', acknowledgmentId, giftId, g.property_version, on, letter.subject, letter.body, c.actor.id, c.now, letter.template_kind, letter.template_id, letter.template_version, previous?.id ?? null,recipient.letter_address),
   sql('UPDATE cf_in_kind_gifts SET version=version+1,updated_at=? WHERE id=?', c.now, giftId),
   event(c, command, 'inKindGift', giftId, donorId, { acknowledgmentId, propertyVersion: g.property_version }),
  ])
  return { id: giftId, donorId, acknowledgmentId, version: version + 1 }
 }
 const disposedOn = date(p.disposedOn, 'Disposed on'), method = choice(p.disposalMethod, IN_KIND_DISPOSALS, 'Disposition method')
 if (disposedOn < g.received_on || disposedOn > day) fail('INPUT', 'Disposition must be on or after this organization received the property and no later than today.', 400)
 const exception = choice(p.disposalException ?? 'none', IN_KIND_EXCEPTIONS, 'Filing exception')
 const evidence = longText(p.disposalEvidence, 'Disposition evidence', 2000)
 if (exception === 'charitable-use' && method !== 'consumed' && method !== 'distributed') fail('INPUT', 'The charitable-purpose exception requires consumption or distribution without consideration in fulfillment of the exempt purpose.', 400)
 const awareOn = optional(p.becameAwareOn, 'Late awareness date', 10)
 if (awareOn) {
  date(awareOn, 'Late awareness date')
  if (awareOn < disposedOn || awareOn > day || p.noReasonToKnow !== 'yes') fail('INPUT', 'A late awareness date must follow disposition, be no later than today, and confirm the organization had no reason to know the donor substantiation requirements applied.', 400)
 }
 await commit(c, [live(donorId), current(giftId, donorId, version),
  guard('EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=? AND disposed_on IS NULL)', 'ALREADY_DISPOSED', 'A disposition is already recorded for this property.', giftId),
  sql('UPDATE cf_in_kind_gifts SET disposed_on=?,disposal_method=?,disposal_exception=?,disposal_evidence=?,became_aware_on=?,version=version+1,updated_at=? WHERE id=?', disposedOn, method, exception, evidence, awareOn, c.now, giftId),
  event(c, command, 'inKindGift', giftId, donorId, { disposedOn, method, exception, becameAwareOn: awareOn }),
 ])
 return { id: giftId, donorId, version: version + 1 }
}

export async function inKindState(c: { db: D1Database }, donorId?: string) {
 const gifts = await all(c, `SELECT g.*,d.name AS donor_name FROM cf_in_kind_current g JOIN cf_donors d ON d.id=g.donor_id WHERE d.erased_at IS NULL ${donorId ? 'AND g.donor_id=?' : ''} ORDER BY g.received_on DESC,g.created_at,g.id`, ...(donorId ? [donorId] : []))
 await withContributionTypes(c, gifts)
 const acknowledgments = await all(c, `SELECT a.* FROM cf_in_kind_acknowledgments a JOIN cf_in_kind_gifts g ON g.id=a.in_kind_id JOIN cf_donors d ON d.id=g.donor_id WHERE d.erased_at IS NULL ${donorId ? 'AND g.donor_id=?' : ''} ORDER BY a.created_at,a.id`, ...(donorId ? [donorId] : []))
 const revisions=await all(c,`SELECT r.* FROM cf_in_kind_revisions r JOIN cf_in_kind_gifts g ON g.id=r.in_kind_id JOIN cf_donors d ON d.id=g.donor_id WHERE d.erased_at IS NULL ${donorId?'AND g.donor_id=?':''} ORDER BY r.property_version`,...(donorId?[donorId]:[]))
 return { gifts: gifts.map(g => ({ ...g, corrections:revisions.filter(r=>r.in_kind_id===g.id).map(r=>({...r,snapshot:JSON.parse(r.snapshot)})), reminders: inKindReminders(g), acknowledgments: acknowledgments.filter(a => a.in_kind_id === g.id).map(a => ({ ...a, current: !a.void_reason && a.property_version === g.property_version })) })), totalStatedValueCents: gifts.reduce((sum, g) => sum + g.stated_value_cents, 0) }
}

/** HTTP caller applies the same authenticated staff-read boundary as donors. */
export async function inKindAcknowledgment(c: { db: D1Database }, acknowledgmentId: string) {
 const a = await one(c, `SELECT a.* FROM cf_in_kind_acknowledgments a JOIN cf_in_kind_gifts g ON g.id=a.in_kind_id JOIN cf_donors d ON d.id=g.donor_id WHERE a.id=? AND d.erased_at IS NULL`, acknowledgmentId)
 if (!a) fail('NOT_FOUND', 'That property acknowledgment is not available.', 404)
 return new Response(`${a.subject}\n\n${receiptText(a)}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="property-acknowledgment.txt"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
