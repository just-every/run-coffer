import { withReceiptBenefits } from './receipt-rules'
import { receiptFundLabels } from './gift-splits'
import { all, commit, event, fail, guard, id, integer, newId, sql, today, type Context, type Row } from './db'
import { address, letterHash } from './acknowledgements'
import { tributeReceiptText } from './gift-depth'
import { usd } from './money'
import { fill, goodsStatement, longDate, settings, type Settings } from './settings'
import { settingsUse, templateFor, templateRevision, templatesUnchanged, templateUse } from './letter-templates'

const MAX_LETTERS = 500
const ELIGIBLE = `g.kind='gift' AND g.received_on>=? AND g.received_on<=?
 AND d.erased_at IS NULL AND (? IS NULL OR d.id=?)
 AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)`

/** One letter per donor: each gift listed once, the totals, and the charity's goods wording. */
function annualLetter(s: Settings, donor: Row, gifts: Row[], year: number, day: string, template: Row | null) {
 const total = gifts.reduce((n, g) => n + g.amount_cents, 0)
 const goods = gifts.reduce((n, g) => n + g.goods_cents, 0)
 const provided = gifts.filter(g => g.goods === 'provided' || g.receipt_statement)
 const items = gifts.map((g, i) => [
  `${i + 1}. ${longDate(g.received_on)} · ${g.receipt_fund ?? g.fund} · ${usd(g.amount_cents)} · goods or services: ${g.receipt_statement ? g.receipt_statement : g.goods === 'provided' ? `${g.goods_description} (${usd(g.goods_cents)})` : 'none'} · deductible ${usd(g.amount_cents - g.goods_cents)}`,
  ...(g.tribute ? [`   ${tributeReceiptText(g.tribute)}`] : []),
 ].join('\n'))
 // A mixed year states each gift's own wording; it never inherits the no-goods sentence.
 const wording = provided.length
  ? [...provided.map(g => `For your gift of ${usd(g.amount_cents)} on ${longDate(g.received_on)}: ${goodsStatement(s, g)}`), ...(provided.length < gifts.length ? [`For each other gift listed: ${s.none_statement}`] : [])]
  : [s.none_statement]
 if (template) {
  // RCPT-007: a reviewed year-end template places the same itemized facts in the charity's own words.
  const fields = { date: longDate(day), donor_name: donor.name, year: String(year), gift_list: items.join('\n'), total: usd(total), goods_total: usd(goods), deductible_total: usd(total - goods), goods_statement: wording.join('\n'), organization: s.organisation, ein: s.ein }
  return { subject: fill(template.subject, fields), body: fill(template.body, fields), amount_cents: total, ...templateUse(template, s) }
 }
 return {
  ...settingsUse(s),
  subject: `${year} annual giving statement — ${s.organisation}`,
  body: [
   longDate(day), '', `Dear ${donor.name},`, '',
   `Thank you for supporting ${s.organisation} in ${year}. For your tax records, this statement lists each gift you made from January 1 through December 31, ${year}.`, '',
   ...items, '',
   `Total gifts: ${usd(total)}`,
   `Total non-exempt goods or services value: ${usd(goods)}`,
   `Total deductible portion: ${usd(total - goods)}`, '',
   ...wording, '',
   'With thanks,', s.organisation, ...(s.ein ? [`EIN ${s.ein}`] : []),
  ].join('\n'),
  amount_cents: total,
 }
}

/** Freeze one annual letter per donor in the normal human approval workflow. */
export async function prepareStatements(c: Context, p: Row): Promise<Row> {
 const s = await settings(c), day = today(s.timezone, new Date(c.now))
 const year = integer(typeof p.year === 'string' ? Number(p.year) : p.year, 'Statement year', 1900, Number(day.slice(0, 4)))
 const donorId = p.donorId === undefined || p.donorId === null || p.donorId === '' ? null : id(p.donorId, 'Donor')
 if (!s.reviewed_at || !s.organisation || !s.ein) fail('SETTINGS_UNREVIEWED', 'A person must review and save the organization name and letter wording in Settings before letters are prepared.')
 const scope = [`${year}-01-01`, `${year}-12-31`, donorId, donorId]
 const donors = await all(c, `SELECT d.* FROM cf_donors d WHERE EXISTS(
  SELECT 1 FROM cf_gifts g WHERE g.donor_id=d.id AND ${ELIGIBLE})
  ORDER BY lower(d.name),d.id LIMIT ${MAX_LETTERS + 1}`, ...scope)
 if (donors.length > MAX_LETTERS) fail('TOO_MANY_LETTERS', 'This year has more than 500 donor statements. Select one donor to prepare their statement.')
 if (!donors.length) fail('NOTHING_DUE', 'No unreversed gifts were found for this calendar year and donor selection.')
 const donorIds = JSON.stringify(donors.map(d => d.id))
 const gifts = await all(c, `SELECT g.id,g.version,g.donor_id,g.received_on,g.amount_cents,g.fund,g.goods,g.goods_cents,g.goods_description
  FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
  WHERE ${ELIGIBLE} AND d.id IN (SELECT value FROM json_each(?)) ORDER BY g.received_on,g.id`, ...scope, donorIds)
 if (gifts.some(g => g.goods === 'unknown')) fail('GOODS_UNKNOWN', 'A gift in this year still needs its goods or services answer. Open the donor’s gift history, record that answer, then prepare the statement again.')
 const tributes = new Map((await all(c, 'SELECT * FROM cf_gift_tributes WHERE gift_id IN (SELECT value FROM json_each(?))', JSON.stringify(gifts.map(g=>g.id)))).map(t=>[t.gift_id,t]))
 await withReceiptBenefits(c, gifts)
 await receiptFundLabels(c,gifts)
 for (const gift of gifts) gift.tribute = tributes.get(gift.id) ?? null
 const batchId = newId(), template = await templateFor(c, 'year_end'), revision = await templateRevision(c)
 const letters = donors.map((d, position) => {
  const selected = gifts.filter(g => g.donor_id === d.id)
  if (!selected.length) fail('GIFTS_CHANGED', 'Gifts changed while preparing the statements. Prepare again.')
  return {
   id: newId(), batch_id: batchId, position, gift_id: selected[0].id, donor_id: d.id,
   recipient_name: d.name, recipient_email: d.email, address: address(d),
   ...annualLetter(s, d, selected, year, day, template), received_on: `${year}-12-31`,
   statement_gifts: JSON.stringify(selected),
  }
 })
 const total = letters.reduce((n, l) => n + l.amount_cents, 0), hash = await letterHash(s.version, letters)
 const snapshots = JSON.stringify(gifts.map(g => ({ ...g, donor_version: donors.find(d => d.id === g.donor_id)!.version })))
 await commit(c, [
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE COALESCE((SELECT version FROM cf_gift_tributes WHERE gift_id=json_extract(j.value,'$.giftId')),0)<>json_extract(j.value,'$.version'))", 'TRIBUTE_CHANGED', 'A tribute changed while preparing. Prepare the statements again.', JSON.stringify(gifts.map(g=>({giftId:g.id,version:tributes.get(g.id)?.version??0})))),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'SETTINGS_CHANGED', 'Letter settings changed while preparing. Prepare again.', s.version), templatesUnchanged(revision),
  // The count covers the entire requested scope, including donors added since
  // selection. Exact rows and donor versions also fence reversals and erasure.
  guard(`(SELECT count(*) FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE ${ELIGIBLE})=?
   AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(
    SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
    WHERE ${ELIGIBLE} AND g.id=json_extract(j.value,'$.id')
     AND g.version=json_extract(j.value,'$.version') AND g.donor_id=json_extract(j.value,'$.donor_id')
     AND g.received_on=json_extract(j.value,'$.received_on') AND g.amount_cents=json_extract(j.value,'$.amount_cents')
     AND g.fund=json_extract(j.value,'$.fund') AND g.goods=json_extract(j.value,'$.goods')
     AND g.goods_cents=json_extract(j.value,'$.goods_cents') AND g.goods_description IS json_extract(j.value,'$.goods_description')
     AND d.version=json_extract(j.value,'$.donor_version')))`,
  'GIFTS_CHANGED', 'Gifts or donor details changed while preparing the statements. Prepare again.', ...scope, gifts.length, snapshots, ...scope),
  guard(`NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id
   WHERE b.kind='statement' AND b.statement_year=? AND b.status<>'discarded'
    AND a.donor_id IN (SELECT value FROM json_each(?)))`,
  'STATEMENT_EXISTS', 'A selected donor already has a statement for this year. Open that batch, or discard it before preparing again. Select a different donor to prepare another statement.', year, donorIds),
  sql(`INSERT INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at,kind,statement_year)
   VALUES(?,1,'prepared',?,?,?,?,?,?,?,?,'statement',?)`, batchId, hash, letters.length, total, s.version, c.actor.id, c.actor.name, c.actor.role, c.now, year),
  sql(`INSERT INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,statement_gifts,template_kind,template_id,template_version)
   SELECT json_extract(value,'$.id'),json_extract(value,'$.batch_id'),json_extract(value,'$.position'),json_extract(value,'$.gift_id'),json_extract(value,'$.donor_id'),0,
    json_extract(value,'$.recipient_name'),json_extract(value,'$.recipient_email'),json_extract(value,'$.address'),json_extract(value,'$.subject'),json_extract(value,'$.body'),
    json_extract(value,'$.amount_cents'),json_extract(value,'$.received_on'),json_extract(value,'$.statement_gifts'),
    json_extract(value,'$.template_kind'),json_extract(value,'$.template_id'),json_extract(value,'$.template_version') FROM json_each(?)`, JSON.stringify(letters)),
  event(c, 'ack.prepareStatements', 'acknowledgements', batchId, null, { year, letters: letters.length, totalCents: total }),
 ])
 return { id: batchId, version: 1, letters: letters.length, totalCents: total, contentHash: hash }
}
