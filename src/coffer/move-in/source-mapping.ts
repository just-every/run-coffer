import { sourceContacts } from './contacts'
import { sourceConsents } from './consent-mapping'
import { sourceRestrictions } from './solicitation-mapping'
import { normalizeLabel } from './source-columns'
import { SourceRow } from './source-rows'
import { acknowledgment } from './acknowledgments'
import { tribute } from './tributes'
import { sourceHousehold } from './households'
import type { ParsedDonor, ParsedImport, ParseInput } from './types'

const donorFields = ['email', 'phone', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'country', 'householdKey', 'householdName'] as const
const provenanceId = (r: SourceRow, kind: string) => `row:${kind}:${r.location.file}:${r.location.sheet}:${r.location.row}`
function addDonor(r: SourceRow, out: ParsedImport) {
 const names = ['name', 'organization', 'firstName', 'middleName', 'lastName'].map(key => r.get(key))
 const prefix = r.get('prefix'), suffix = r.get('suffix')
 let name = names[0] || names[1] || names.slice(2).filter(Boolean).join(' ')
 if (!names[1]) {
  if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase()+' ')) name = `${prefix} ${name}`
  if (suffix && !name.toLowerCase().endsWith(' '+suffix.toLowerCase())) name = `${name} ${suffix}`
 }
 if (!name) return
 const externalId = r.required('donorId'); if (!externalId) return
 // An organization keeps no household: LGL's Is Org, a Bloomerang Organization type, or an organization name alone.
 const organization = /^(yes|true|y|1)$/i.test(r.get('isOrg')) || normalizeLabel(r.peek('type')) === 'organization' || (!!names[1] && !names[2] && !names[4])
 const donor: ParsedDonor = { location: r.location, externalId, name, firstName: names[2], middleName: names[3], lastName: names[4], prefix, suffix, nickname:r.get('nickname'), recognitionName:r.get('recognitionName'), constituentStatus:sourceStatus(r), deceasedOn:r.peek('deceasedOn')?r.date('deceasedOn'):'', statusReason:r.get('statusReason'), informalName:r.get('informalName'), formalName:r.get('formalName'), envelopeName:r.get('envelopeName'), organization, ...Object.fromEntries(donorFields.map(key => [key, r.get(key)])) } as ParsedDonor
 sourceContacts(r,donor)
 donor.email = donor.email.toLowerCase()
 if (donor.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donor.email)) r.error('EMAIL', 'Export a single valid primary email address.', 'email')
 if (donor.householdName && !donor.householdKey) r.error('HOUSEHOLD_ID', 'Fill Household ID with this household’s source ID, or clear Household Name if this constituent has no household.', 'householdKey')
 if (donor.householdKey && !donor.householdName) r.error('HOUSEHOLD_NAME', 'Fill Household Name for this Household ID, or clear Household ID if this constituent has no household.', 'householdName')
 const existing = out.donors.find(d => d.externalId === externalId)
 if(existing&&donor.contacts){if(existing.contacts&&JSON.stringify(existing.contacts)!==JSON.stringify(donor.contacts))r.error('CONTACT_CONFLICT','Contact exports for this constituent disagree. Export one authoritative contact set.','email');else existing.contacts=donor.contacts}
 if (!existing) out.donors.push(donor)
 else {
  for (const key of ['name', ...donorFields] as const) {
   if (existing[key] && donor[key] && existing[key] !== donor[key]) r.error('DONOR_CONFLICT', `Conflicting ${key} for source constituent ${externalId}${out.source === 'lgl' ? ' in the constituents report. Correct the constituent rows so this ID has one value' : '. Export one authoritative value'}.`, key)
   else if (!existing[key]) existing[key] = donor[key]??''
  }
  for (const key of ['prefix','firstName','middleName','lastName','suffix','nickname','recognitionName','constituentStatus','deceasedOn','statusReason','informalName','formalName','envelopeName'] as const) {
   const value=donor[key]
   if (existing[key] && value && existing[key]!==value) r.error('DONOR_CONFLICT',`Conflicting ${key} for source constituent ${externalId}.`,key)
   else if (!existing[key]&&value) existing[key]=value
  }
  existing.organization ||= donor.organization
 }
 sourceHousehold(r,out,donor)
}

function sourceStatus(r:SourceRow) {
 const raw=r.get('constituentStatus').toLowerCase()
 if (!raw) return r.peek('deceasedOn') ? 'deceased' : undefined
 if (['yes','true','y','1','deceased'].includes(raw)) return 'deceased'
 if (['no','false','n','0','active','living'].includes(raw)) return 'active'
 if (raw==='inactive') return 'inactive'
 r.error('CONSTITUENT_STATUS','Export active, inactive or deceased status (or a yes/no deceased flag).','constituentStatus')
 return undefined
}

function note(r: SourceRow, out: ParsedImport, standalone = false) {
 const text = r.get('note'); if (!text) { if (standalone) r.error('NOTE', 'Fill Note with the note text, or remove this empty note row.', 'note'); return }
 const donorExternalId = r.required('donorId'), date = r.peek('noteDate') ? r.date('noteDate') : standalone && r.peek('date') ? r.date('date') : ''
 const externalId = r.get('noteId') || provenanceId(r, 'note'), type = r.get('noteType').toLowerCase()
 if (donorExternalId) out.notes.push({ location: r.location, externalId, donorExternalId, text, date, type })
}
const RELATIONSHIP_TYPES: Record<string, string> = { spouse: 'spouse', employer: 'employer', boardmember: 'board_member', foundationofficer: 'foundation_officer', introducedby: 'introduced_by' }
function relationship(r: SourceRow, out: ParsedImport) {
 const donorExternalId = r.required('donorId'), relatedDonorExternalId = r.required('relatedDonor'), rawType = r.required('relationshipType'), key = normalizeLabel(rawType), type = (Object.hasOwn(RELATIONSHIP_TYPES,key) ? RELATIONSHIP_TYPES[key] : undefined) || rawType.toLowerCase()
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
 if (!giftExternalId) r.error('SOFT_GIFT', 'Fill Related Gift ID with the original received gift’s ID. A credited donor name cannot identify the gift.')
 if (!donorExternalId) r.error('SOFT_DONOR', 'Fill Constituent ID with the person being recognized.')
 const specific = acknowledgment(r, true), shared = inline ? undefined : acknowledgment(r)
 if (specific && shared && JSON.stringify(specific) !== JSON.stringify(shared)) r.error('ACKNOWLEDGMENT_CONFLICT', 'The soft-credit acknowledgment columns disagree. Export one consistent acknowledgment history for this credit.')
 const creditAcknowledgment = specific ?? shared
 if (giftExternalId && donorExternalId && amountCents !== null) out.softCredits.push({ location: r.location, externalId, donorExternalId, giftExternalId, amountCents, pledgeExternalId, ...(creditAcknowledgment ? { acknowledgment: creditAcknowledgment } : {}) })
}
function method(r: SourceRow) {
 const raw = r.get('method'), key = normalizeLabel(raw)
 const methods: Record<string, string> = { check: 'check', cheque: 'check', creditcard: 'card', debitcard: 'card', card: 'card', online: 'online', paypal: 'online', cash: 'cash', banktransfer: 'bank transfer', directdebit: 'bank transfer', ach: 'bank transfer', eft: 'bank transfer', other: 'other' }
 const mapped = Object.hasOwn(methods,key) ? methods[key] : undefined
 if (!mapped) r.result.diagnostics.push({ ...r.location, severity: 'warning', code: 'PAYMENT_METHOD', message: raw ? `Source payment method preserved as ${raw}.` : 'No source payment method; marked imported.' })
 return mapped || raw || 'imported'
}
// GIFT-003: a mapped channel column names one of Coffer's five channels; anything else stops the row.
const CHANNEL_VALUES: Record<string, string> = { form: 'form', onlineform: 'form', givingform: 'form', donationform: 'form', website: 'form', event: 'event', mail: 'mail', directmail: 'mail', mailpiece: 'mail', letter: 'mail', email: 'email', text: 'text', sms: 'text', texttogive: 'text' }
function channel(r: SourceRow) {
 const raw = r.has('channel') ? r.get('channel') : ''
 if (!raw) return undefined
 const key = normalizeLabel(raw), value = Object.hasOwn(CHANNEL_VALUES,key) ? CHANNEL_VALUES[key] : undefined
 if (!value) r.error('CHANNEL', `Channel ${raw} is not one of Form, Event, Mail, Email or Text; correct it in the export or leave it blank.`, 'channel')
 return value
}
function gift(r: SourceRow, out: ParsedImport, input: ParseInput) {
 const externalId = r.required('giftId'), donorExternalId = r.required('donorId'), amountCents = r.cents('amount'), receivedOn = r.date('date')
 const fund = r.get('fund'), campaign = r.get('campaign'), appeal = r.has('appeal') ? r.get('appeal') : undefined, checkReference = r.get('checkReference') || undefined, payment = method(r), pledgeExternalId = r.get('parentId') || r.get('pledgeId')
 const note = [r.get('giftNote') || r.get('note'), r.has('appeal') && campaign ? `Campaign: ${campaign}` : ''].filter(Boolean).join('\n')
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
 const giftChannel = channel(r), giftAcknowledgment = acknowledgment(r), giftTribute = tribute(r)
 if (fund.includes(';') || campaign.includes(';')) r.error('SPLIT_GIFT', 'Export one designation per row with a unique gift/designation ID and amount; grouped split funds or campaigns cannot be allocated safely.')
 if (externalId && donorExternalId && amountCents !== null && receivedOn) out.gifts.push({ location: r.location, externalId, donorExternalId, amountCents, receivedOn, fund, campaign, appeal, channel: giftChannel, checkReference, method: payment, note, pledgeExternalId, noGoodsOrServices: goodsCents === 0, goodsCents, goodsDescription, ...(giftTribute ? { tribute: giftTribute } : {}), ...(giftAcknowledgment ? { acknowledgment: giftAcknowledgment } : {}) })
 if (r.peek('softDonor')) softCredit(r, out, true)
}
function pledge(r: SourceRow, out: ParsedImport) {
 const externalId = r.get('giftId') || r.get('pledgeId'), donorExternalId = r.required('donorId'), amountCents = r.cents('amount'), pledgedOn = r.date('date'), fund = r.get('fund'), campaign = r.get('campaign'), method = r.get('method')
 // A pledge keeps its campaign and stated payment method as part of its note.
 const appeal = r.get('appeal'), checkReference = r.get('checkReference')
 const note = [r.get('giftNote') || r.get('note'), campaign && `Campaign: ${campaign}`, appeal && `Appeal: ${appeal}`, checkReference && `Check/reference: ${checkReference}`, method && `Payment method: ${method}`].filter(Boolean).join('\n')
 if (!externalId) r.error('PLEDGE_ID', 'Fill Gift ID or Pledge ID with this pledge’s source record ID.')
 if (externalId && donorExternalId && amountCents !== null && pledgedOn) out.pledges.push({ location: r.location, externalId, donorExternalId, amountCents, pledgedOn, fund, note })
}
function installment(r: SourceRow, out: ParsedImport) {
 const externalId = r.get('installmentId') || r.get('giftId'), pledgeExternalId = r.get('pledgeId') || r.get('parentId'), dueOn = r.date(r.peek('dueOn') ? 'dueOn' : 'date'), amountCents = r.cents(r.peek('installmentAmount') ? 'installmentAmount' : 'amount')
 if (!externalId) r.error('INSTALLMENT_ID', 'Fill Installment ID with this installment’s source record ID.')
 if (!pledgeExternalId) r.error('INSTALLMENT_PLEDGE', 'Fill Pledge ID or Parent Gift ID with this installment’s parent pledge ID.')
 if (externalId && pledgeExternalId && dueOn && amountCents !== null) out.installments.push({ location: r.location, externalId, pledgeExternalId, dueOn, amountCents })
}
export function mapRow(r: SourceRow, out: ParsedImport, input: ParseInput) {
 const kind = r.kind(); r.get('type')
 if(r.peek('communicationRestrictions'))sourceRestrictions(r,out,input)
 if(kind==='donor'||(out.source!=='lgl'&&['email','mail','sms','phone'].some(channel=>r.has(channel+'Consent')||r.has(channel+'OptOut'))))sourceConsents(r,out)
 // LGL repeats display names in gift and relationship reports. Only constituent
 // records define donors: labels on referenced records cannot create or rename one.
 if (out.source === 'lgl') {
  r.get('sortName'); r.get('relatedName')
  if (kind !== 'donor' && kind !== 'control') for (const field of ['name', 'organization', 'firstName', 'middleName', 'lastName']) r.get(field)
 }
 if (kind === 'unsupported') { r.error('ROW_TYPE', 'Unrecognized record or transaction type. Include Gift Type/Transaction Type and export unsupported records separately.'); r.finish(); return }
 if (out.source !== 'lgl' || kind === 'donor' || kind === 'control') addDonor(r, out)
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
