import { letterRecipient } from './organizations'
import { address, letterHash } from './acknowledgements'
import { all, commit, event, fail, guard, newId, sql, today, type Context, type Row, type Stmt } from './db'
import { allocateCents, allGiftAllocations } from './gift-splits'
import { householdState } from './households'
import { settings } from './settings'
import { templateFor, templateRevision, templatesUnchanged } from './letter-templates'
import { receiptNumber } from './receipt-format'
import { withReceiptBenefits } from './receipt-rules'
import { annualLetter } from './year-end'

const scope = `NOT EXISTS(SELECT 1 FROM cf_contribution_types t WHERE t.gift_id=g.id AND t.kind='daf') AND g.received_on>=? AND g.received_on<=? AND g.net_cents>0
 AND d.id IN (SELECT value FROM json_each(?)) AND d.erased_at IS NULL`

/** One piece for the household's current members, each hard-credit gift once.
 * No head, soft credit, pledge or property value determines legal gift identity. */
export async function householdStatementPlan(c:Context,year:number,householdId:string,original?:Row,target?:{batchId?:string;position?:number;emailType?:string;addressType?:string}) {
 const s = await settings(c), day = today(s.timezone, new Date(c.now))
 if (!s.reviewed_at || !s.organisation || !s.ein) fail('SETTINGS_UNREVIEWED', 'Review organization and receipt settings before preparing statements.')
 const state = await householdState(c, householdId, { year, basis: 'calendar' })
 const { household, members, names } = state
 if (household.survivor_review) fail('NAMES_UNCONFIRMED', 'A member was marked deceased or restored, so the household names were recomputed. Confirm them on the household before preparing a statement.')
 const memberIds = JSON.stringify(members.map(m => m.id)), period = [`${year}-01-01`, `${year}-12-31`, memberIds]
 const gifts = await all(c, `SELECT g.*,d.name AS donor_name,d.version AS donor_version FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE ${scope} ORDER BY g.received_on,g.id`, ...period)
 if (!gifts.length) fail('NOTHING_DUE', 'No remaining monetary gifts were found for this calendar year and household.')
 if (gifts.some(g => g.goods === 'unknown')) fail('GOODS_UNKNOWN', 'A household gift still needs its goods or services answer. Record that answer before preparing the statement.')
 if (gifts.some(g => g.goods_cents > g.net_cents)) fail('GOODS_REVIEW', 'A benefit value exceeds a gift’s remaining contribution. Review the financial correction before preparing a statement.')
 const giftIds = JSON.stringify(gifts.map(g => g.id))
 const [tributeRows, allocations, template, revision] = await Promise.all([
  all(c, 'SELECT * FROM cf_gift_tributes WHERE gift_id IN (SELECT value FROM json_each(?))', giftIds),
  allGiftAllocations(c, gifts.map(g => g.id)), templateFor(c, 'year_end'), templateRevision(c), withReceiptBenefits(c, gifts),
 ])
 for (const gift of gifts) {
  gift.original_amount_cents = gift.amount_cents
  gift.amount_cents = gift.net_cents
  gift.tribute = tributeRows.find(t => t.gift_id === gift.id) ?? null
  const parts = allocations.filter(a => a.gift_id === gift.id)
  if (parts.length) {
   const net = allocateCents(gift.net_cents, parts.map(a => ({ amountCents: a.amount_cents })))
   gift.receipt_fund = parts.map((a, i) => `${a.fund}${a.campaign ? ` (${a.campaign})` : ''}: $${(net[i] / 100).toFixed(2)}`).join('; ')
  }
 }
 const snapshot = { members: members.map(m => ({ id: m.id, name: m.name })), names, headStatus: state.headStatus, overridesReview: !!household.overrides_review, asOf: day }
 // A stable member order supplies delivery contact details, independently of headship.
 const member=members.find(m=>m.constituent_status==='active')
 if(!member)fail('DONOR_STATUS','No active household member can receive this statement.',409)
 const contact=await letterRecipient(c,member,{day,emailType:target?.emailType,addressType:target?.addressType}),batchId=target?.batchId??newId(),letterId=newId()
 const rendered = annualLetter(s, { ...contact, name: names.formal, letter_household_names: names, letter_address: contact.letter_address, letter_name: names.addressee, letter_names: { informal: names.informal, formal: names.formal, envelope: names.addressee } }, gifts, year, day, template)
 const basis = `Household statement — current members as of ${day}: ${members.map(m => m.name).join('; ')}. Each gift is listed under its hard-credit donor.`
 const body = `${basis}\n\n${rendered.body}`
 const letter = {
  id: letterId, batch_id: batchId, position: target?.position??0, gift_id: gifts[0].id, donor_id: contact.id, live: 0,
  recipient_name: names.addressee, recipient_email: contact.email, address: contact.letter_address, ...rendered,
  body: original ? `Corrected statement replacing ${receiptNumber(original)}.\nWhat changed: ${original.void_reason}. Use this corrected statement in place of the original.\n\n${body}` : body,
  received_on: `${year}-12-31`, statement_gifts: JSON.stringify(gifts), household_id: householdId,
  household_version: household.version, household_snapshot: JSON.stringify(snapshot), replaces_id: original?.id ?? null,
 }
 const hash = await letterHash(s.version, [letter])
 const checks:Stmt[]=[
  guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)', 'HOUSEHOLD_CHANGED', 'This household changed. Prepare the statement again.', householdId, household.version),
  guard(`(SELECT count(*) FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE ${scope})=?
   AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id
    WHERE g.id=json_extract(j.value,'$.id') AND g.version=json_extract(j.value,'$.version') AND g.net_cents=json_extract(j.value,'$.amount_cents')
    AND g.donor_id=json_extract(j.value,'$.donor_id') AND d.version=json_extract(j.value,'$.donor_version') AND d.erased_at IS NULL))`,
   'GIFTS_CHANGED', 'Gifts or donor details changed while preparing. Prepare the household statement again.', ...period, gifts.length, letter.statement_gifts),
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE COALESCE((SELECT version FROM cf_gift_tributes WHERE gift_id=json_extract(j.value,'$.id')),0)<>COALESCE(json_extract(j.value,'$.tribute.version'),0))", 'TRIBUTE_CHANGED', 'A tribute changed. Prepare the statement again.', letter.statement_gifts),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'SETTINGS_CHANGED', 'Receipt settings changed. Prepare again.', s.version), templatesUnchanged(revision),
  guard(`NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.household_id=? AND b.statement_year=? AND b.status<>'discarded' AND (?=0 OR a.void_reason IS NULL))`,
   'STATEMENT_EXISTS', 'This household already has a statement for this year. Open its batch to discard or correct it.', householdId, year, original ? 1 : 0),
  ...(original ? [guard('EXISTS(SELECT 1 FROM cf_acks WHERE id=? AND void_reason IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM cf_acks WHERE replaces_id=?)', 'RECEIPT_CHANGED', 'This statement already has a replacement. Open its batch.', original.id, original.id)] : [])
 ]
 return {s,letter,hash,batchId,letterId,household,checks}
}

export async function prepareHouseholdStatement(c:Context,year:number,householdId:string,original?:Row,options:{emailType?:string;addressType?:string}={}):Promise<Row>{
 const {s,letter,hash,batchId,letterId,household,checks}=await householdStatementPlan(c,year,householdId,original,options)
 await commit(c,[...checks,
  sql(`INSERT INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at,kind,statement_year,one_piece_per)
   VALUES(?,1,'prepared',?,1,?,?,?,?,?,?,'statement',?,'household')`, batchId, hash, letter.amount_cents, s.version, c.actor.id, c.actor.name, c.actor.role, c.now, year),
  sql(`INSERT INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,statement_gifts,template_kind,template_id,template_version,household_id,household_version,household_snapshot,replaces_id,merge_blanks)
   VALUES(?,?,0,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, letterId, batchId, letter.gift_id, letter.donor_id, letter.recipient_name, letter.recipient_email, letter.address, letter.subject, letter.body, letter.amount_cents, letter.received_on, letter.statement_gifts, letter.template_kind, letter.template_id, letter.template_version, householdId, household.version, letter.household_snapshot, letter.replaces_id, letter.merge_blanks),
  event(c, original ? 'ack.correct' : 'ack.prepareStatements', 'acknowledgements', batchId, null, { householdId, householdVersion: household.version, year, letters: 1, totalCents: letter.amount_cents, ...(original ? { originalLetterId: original.id, letterId } : {}) }),
 ])
 return { id: batchId, version: 1, letters: 1, totalCents: letter.amount_cents, contentHash: hash, householdId, ...(original ? { replacesId: original.id } : {}) }
}
