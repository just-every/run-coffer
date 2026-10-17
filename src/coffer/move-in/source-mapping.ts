import { normalizeLabel } from './source-columns'
import { SourceRow } from './source-rows'
import type { ParsedDonor, ParsedImport, ParseInput } from './types'

const donorFields = ['email', 'phone', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'country', 'householdKey', 'householdName'] as const
const provenanceId = (r: SourceRow, kind: string) => `row:${kind}:${r.location.file}:${r.location.sheet}:${r.location.row}`
function addDonor(r: SourceRow, out: ParsedImport) {
 const names = ['name', 'organization', 'firstName', 'middleName', 'lastName'].map(key => r.get(key))
 const name = names[0] || names[1] || names.slice(2).filter(Boolean).join(' ')
 if (!name) return
 const externalId = r.required('donorId'); if (!externalId) return
 // An organization keeps no household: LGL's Is Org, a Bloomerang Organization type, or an organization name alone.
 const organization = /^(yes|true|y|1)$/i.test(r.get('isOrg')) || normalizeLabel(r.peek('type')) === 'organization' || (!!names[1] && !names[2] && !names[4])
 const donor: ParsedDonor = { location: r.location, externalId, name, firstName: names[2], lastName: names[4], organization, ...Object.fromEntries(donorFields.map(key => [key, r.get(key)])) } as ParsedDonor
 donor.email = donor.email.toLowerCase()
 if (donor.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donor.email)) r.error('EMAIL', 'Export a single valid primary email address.', 'email')
 if (donor.householdName && !donor.householdKey) r.error('HOUSEHOLD_ID', 'Household name needs its source household ID; names are not reliable identity keys.', 'householdKey')
 if (donor.householdKey && !donor.householdName) r.error('HOUSEHOLD_NAME', 'Household ID needs a household name.', 'householdName')
 const existing = out.donors.find(d => d.externalId === externalId)
 if (!existing) out.donors.push(donor)
 else {
  for (const key of ['name', ...donorFields] as const) {
   if (existing[key] && donor[key] && existing[key] !== donor[key]) r.error('DONOR_CONFLICT', `Conflicting ${key} for source constituent ${externalId}. Export one authoritative value.`, key)
   else if (!existing[key]) existing[key] = donor[key]
  }
  existing.firstName ||= donor.firstName; existing.lastName ||= donor.lastName; existing.organization ||= donor.organization
 }
 if (donor.householdKey && donor.householdName) {
  const household = out.households.find(h => h.externalId === donor.householdKey)
  if (!household) out.households.push({ externalId: donor.householdKey, name: donor.householdName, location: r.location })
  else if (household.name !== donor.householdName) r.error('HOUSEHOLD_CONFLICT', `Conflicting names for household ${household.externalId}.`)
 }
}
function note(r: SourceRow, out: ParsedImport, standalone = false) {
 const text = r.get('note'); if (!text) { if (standalone) r.error('NOTE', 'Missing note text.'); return }
 const donorExternalId = r.required('donorId'), date = r.peek('noteDate') ? r.date('noteDate') : standalone && r.peek('date') ? r.date('date') : ''
 const externalId = r.get('noteId') || provenanceId(r, 'note'), type = r.get('noteType').toLowerCase()
 if (donorExternalId) out.notes.push({ location: r.location, externalId, donorExternalId, text, date, type })
}
function relationship(r: SourceRow, out: ParsedImport) {
 const donorExternalId = r.required('donorId'), relatedDonorExternalId = r.required('relatedDonor'), rawType = r.required('relationshipType'), type = ({ spouse: 'spouse', employer: 'employer', boardmember: 'board_member', foundationofficer: 'foundation_officer', introducedby: 'introduced_by' } as Record<string, string>)[normalizeLabel(rawType)] || rawType.toLowerCase()
 const externalId = r.get('relationshipId') || provenanceId(r, 'relationship')
 if (donorExternalId && relatedDonorExternalId && type) out.relationships.push({ location: r.location, externalId, donorExternalId, relatedDonorExternalId, type })
}
function softCredit(r: SourceRow, out: ParsedImport, inline = false) {
 const donorExternalId = r.get('softDonor') || (!inline ? r.required('donorId') : '')
 const giftExternalId = r.get('softGift') || (inline ? r.required('giftId') : r.get('parentId'))
 // A soft credit row repeats the original gift's date, fund, campaign and payment; the original gift keeps them.
 if (!inline) for (const field of ['date', 'fund', 'campaign', 'method', 'type', 'giftNote']) r.get(field)
 const amountCents = r.cents(r.peek('softAmount') ? 'softAmount' : 'amount')
 const externalId = r.get('softId') || (!inline ? r.get('giftId') : '') || provenanceId(r, 'credit'), pledgeExternalId = r.get('pledgeId')
 if (!giftExternalId) r.error('SOFT_GIFT', 'A soft credit needs the original received gift ID. A credited donor name cannot identify the gift.')
 if (!donorExternalId) r.error('SOFT_DONOR', 'A soft credit needs the credited constituent ID.')
 if (giftExternalId && donorExternalId && amountCents !== null) out.softCredits.push({ location: r.location, externalId, donorExternalId, giftExternalId, amountCents, pledgeExternalId })
}
function method(r: SourceRow) {
 const raw = r.get('method'), key = normalizeLabel(raw)
 const methods: Record<string, string> = { check: 'check', cheque: 'check', creditcard: 'card', debitcard: 'card', card: 'card', online: 'online', paypal: 'online', cash: 'cash', banktransfer: 'bank transfer', directdebit: 'bank transfer', ach: 'bank transfer', eft: 'bank transfer', other: 'other' }
 if (!methods[key]) r.result.diagnostics.push({ ...r.location, severity: 'warning', code: 'PAYMENT_METHOD', message: raw ? `Source payment method preserved as ${raw}.` : 'No source payment method; marked imported.' })
 return methods[key] || raw || 'imported'
}
function gift(r: SourceRow, out: ParsedImport, input: ParseInput) {
 const externalId = r.required('giftId'), donorExternalId = r.required('donorId'), amountCents = r.cents('amount'), receivedOn = r.date('date')
 const fund = r.get('fund'), campaign = r.get('campaign'), payment = method(r), pledgeExternalId = r.get('parentId') || r.get('pledgeId')
 const note = r.get('giftNote') || r.get('note')
 let goodsCents: number | null = null
 const goodsDescription = r.get('goodsDescription')
 if (r.peek('goodsAmount')) goodsCents = r.cents('goodsAmount', true)
 if (r.peek('deductible')) {
  const deductible = r.cents('deductible', true)
  if (deductible !== null && amountCents !== null) {
   const difference = amountCents - deductible
   if (difference < 0 || (goodsCents !== null && goodsCents !== difference)) r.error('DEDUCTIBILITY', 'Deductible and benefit amounts conflict with the gift amount.', 'deductible')
   else goodsCents = difference
  }
 }
 if (goodsCents !== null && amountCents !== null && goodsCents >= amountCents && goodsCents !== 0) r.error('GOODS_VALUE', r.peek('deductible') ? `Deductible Amount ${r.peek('deductible')} means the donor received goods or services worth the whole ${r.peek('amount')}, so no part of it was a gift. Coffer records gifts worth more than what the donor received: set Deductible Amount to the part that was a gift, or delete the row if it was a purchase.` : 'Benefit amount must be less than the received gift amount.', r.peek('deductible') ? 'Deductible Amount' : 'goodsAmount')
 if (goodsCents === null && input.noGoodsOrServices === true) goodsCents = 0
 if (fund.includes(';') || campaign.includes(';')) r.error('SPLIT_GIFT', 'Export one designation per row with a unique gift/designation ID and amount; grouped split funds or campaigns cannot be allocated safely.')
 if (externalId && donorExternalId && amountCents !== null && receivedOn) out.gifts.push({ location: r.location, externalId, donorExternalId, amountCents, receivedOn, fund, campaign, method: payment, note, pledgeExternalId, noGoodsOrServices: goodsCents === 0, goodsCents, goodsDescription })
 if (r.peek('softDonor')) softCredit(r, out, true)
}
function pledge(r: SourceRow, out: ParsedImport) {
 const externalId = r.get('giftId') || r.get('pledgeId'), donorExternalId = r.required('donorId'), amountCents = r.cents('amount'), pledgedOn = r.date('date'), fund = r.get('fund'), campaign = r.get('campaign'), method = r.get('method')
 // A pledge keeps its campaign and stated payment method as part of its note.
 const note = [r.get('giftNote') || r.get('note'), campaign && `Campaign: ${campaign}`, method && `Payment method: ${method}`].filter(Boolean).join('\n')
 if (!externalId) r.error('PLEDGE_ID', 'A pledge needs its source gift/pledge ID.')
 if (externalId && donorExternalId && amountCents !== null && pledgedOn) out.pledges.push({ location: r.location, externalId, donorExternalId, amountCents, pledgedOn, fund, note })
}
function installment(r: SourceRow, out: ParsedImport) {
 const externalId = r.get('installmentId') || r.get('giftId'), pledgeExternalId = r.get('pledgeId') || r.get('parentId'), dueOn = r.date(r.peek('dueOn') ? 'dueOn' : 'date'), amountCents = r.cents(r.peek('installmentAmount') ? 'installmentAmount' : 'amount')
 if (!externalId) r.error('INSTALLMENT_ID', 'An installment needs a source installment ID.')
 if (!pledgeExternalId) r.error('INSTALLMENT_PLEDGE', 'An installment needs its parent pledge ID.')
 if (externalId && pledgeExternalId && dueOn && amountCents !== null) out.installments.push({ location: r.location, externalId, pledgeExternalId, dueOn, amountCents })
}
export function mapRow(r: SourceRow, out: ParsedImport, input: ParseInput) {
 const kind = r.kind(); r.get('type')
 if (kind === 'unsupported') { r.error('ROW_TYPE', 'Unrecognized record or transaction type. Include Gift Type/Transaction Type and export unsupported records separately.'); r.finish(); return }
 addDonor(r, out)
 if (kind === 'control') { note(r, out); return }
 switch (kind) {
  case 'donor': note(r, out); if (r.peek('relatedDonor')) relationship(r, out); break
  case 'gift': gift(r, out, input); break
  case 'pledge': pledge(r, out); break
  case 'installment': installment(r, out); break
  case 'softCredit': softCredit(r, out); break
  case 'relationship': relationship(r, out); note(r, out); break
  case 'note': note(r, out, true); break
 }
 r.finish()
}
