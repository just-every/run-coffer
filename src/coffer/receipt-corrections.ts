import { receiptNumber } from './receipt-format'
import { address, letterHash } from './acknowledgements'
import { all, commit, event, fail, guard, id, newId, one, sql, today, type Context, type Row } from './db'
import { giftTemplates, renderGiftLetter, templateRevision, templatesUnchanged } from './letter-templates'
import { withReceiptBenefits } from './receipt-rules'
import { allocateCents, receiptFundLabels } from './gift-splits'
import { settings } from './settings'

/** Reissue only from current ledger facts. The original stays in its batch;
 * this exact replacement must receive ordinary human approval before sending. */
export async function correctReceipt(c: Context, p: Row): Promise<Row> {
 const original = await one(c, `SELECT a.*,b.kind,b.statement_year FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.id=?`, id(p.letterId, 'Receipt'))
 if (!original) fail('NOT_FOUND', 'That receipt does not exist.', 404)
 if (original.void_reason && original.kind === 'statement' && original.household_id) return (await import('./household-statements')).prepareHouseholdStatement(c, original.statement_year, original.household_id, original)
 if (!original.void_reason || original.kind === 'statement') fail('NOT_CORRECTABLE', 'Choose a voided individual gift receipt. Annual statements remain void after their facts change.')
 const gift = await one(c, 'SELECT * FROM cf_gift_balances WHERE id=?', original.gift_id)
 if (!gift || gift.net_cents <= 0) fail('NO_CONTRIBUTION', 'A fully reversed or refunded gift has a void receipt and cannot be reissued.')
 const donor = await one(c, 'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL', gift.donor_id)
 if (!donor) fail('NOT_FOUND', 'That donor is unavailable.', 404)
 if (gift.goods === 'unknown' || gift.goods_cents >= gift.net_cents) fail('GOODS_REVIEW', 'The original benefit value consumes the remaining contribution. Keep the receipt void; no deductible replacement can be prepared.')
 const s = await settings(c), revision = await templateRevision(c)
 if (!s.reviewed_at || !s.ein) fail('SETTINGS_UNREVIEWED', 'Review organization and receipt settings first.')
 const current: Row = { ...gift, amount_cents: gift.net_cents }
 await withReceiptBenefits(c, [current]); await receiptFundLabels(c, [current])
 const allocations = await all(c, 'SELECT * FROM cf_gift_allocations WHERE gift_id=? ORDER BY position', gift.id)
 if (allocations.length) {
  const parts = allocateCents(gift.net_cents, allocations.map(a => ({ amountCents: a.amount_cents })))
  current.receipt_fund = allocations.map((a, i) => `${a.fund}: $${(parts[i] / 100).toFixed(2)}`).join('; ')
 }
 const rendered = renderGiftLetter(s, current, donor.name, today(s.timezone, new Date(c.now)), (await giftTemplates(c, [current])).get(gift.id))
 const batchId = newId(), letterId = newId()
 const letter = { id: letterId, batch_id: batchId, position: 0, gift_id: gift.id, donor_id: donor.id, recipient_name: donor.name, recipient_email: donor.email, address: address(donor),
  ...rendered, body: `Corrected receipt replacing ${receiptNumber(original)}.\nWhat changed: ${original.void_reason}. Original contribution $${(original.amount_cents / 100).toFixed(2)}; current contribution $${(gift.net_cents / 100).toFixed(2)}. Use this corrected receipt in place of the original.\n\n${rendered.body}`,
  amount_cents: gift.net_cents, received_on: gift.received_on }
 const hash = await letterHash(s.version, [letter])
 await commit(c, [
  guard('EXISTS(SELECT 1 FROM cf_acks WHERE id=? AND void_reason IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM cf_acks WHERE replaces_id=?)', 'RECEIPT_CHANGED', 'This receipt already has a replacement. Open its batch.', original.id, original.id),
  guard('EXISTS(SELECT 1 FROM cf_gift_balances WHERE id=? AND net_cents=? AND donor_id=? AND version=?)', 'GIFT_CHANGED', 'The gift changed. Prepare again.', gift.id, gift.net_cents, donor.id, gift.version),
  guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)', 'DONOR_CHANGED', 'The donor changed. Prepare again.', donor.id, donor.version),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'SETTINGS_CHANGED', 'Receipt settings changed. Prepare again.', s.version), templatesUnchanged(revision),
  sql('UPDATE cf_acks SET live=0 WHERE gift_id=?', gift.id),
  sql("INSERT INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,'prepared',?,1,?,?,?,?,?,?)", batchId, hash, gift.net_cents, s.version, c.actor.id, c.actor.name, c.actor.role, c.now),
  sql(`INSERT INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,template_kind,template_id,template_version,replaces_id)
   VALUES(?,?,0,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`, letterId,batchId,gift.id,donor.id,letter.recipient_name,letter.recipient_email,letter.address,letter.subject,letter.body,letter.amount_cents,letter.received_on,letter.template_kind,letter.template_id,letter.template_version,original.id),
  event(c, 'ack.correct', 'acknowledgements', batchId, donor.id, { originalLetterId: original.id, letterId, amountCents: gift.net_cents }),
 ])
 return { id: batchId, version: 1, replacesId: original.id }
}
