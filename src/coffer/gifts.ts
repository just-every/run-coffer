import { benefitStatements, receiptBenefit } from './receipt-rules'
import { choice, commit, date, event, fail, guard, id, integer, newId, one, optional, sql, text, today, type Context, type Row } from './db'
import { giftInstallmentStatements } from './pledges'
import { amount } from './money'
import { settings } from './settings'
import { giftAllocationStatements, prepareGiftAllocations } from './gift-splits'
import { entryAttribution } from './attribution'

export const METHODS = ['check', 'card', 'online', 'cash', 'bank transfer', 'other'] as const

function goods(p: Row, giftCents: number) {
 const kind = choice(p.goods, ['none', 'provided'] as const, 'whether the donor received goods or services')
 if (kind === 'none') return { kind, cents: 0, description: null }
 const cents = amount(p, 'goodsValue', 'Value of goods or services'), description = text(p.goodsDescription, 'Goods or services description', 300)
 if (cents >= giftCents) fail('INPUT', 'Goods or services must be worth less than the gift.', 400)
 return { kind, cents, description }
}

/** Gifts are immutable ledger lines in integer cents; corrections are reversals. */
export async function giftCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'gift.record') {
  const donorId = id(p.donorId, 'Donor'), giftId = newId(), cents = amount(p, 'amount', 'Gift amount'), received = date(p.receivedOn, 'Received on')
  const s = await settings(c), benefit = receiptBenefit(p, cents, received, s)
  if (received > today(s.timezone)) fail('INPUT', 'A gift records money already received; its date cannot be in the future.', 400)
  const allocations = await prepareGiftAllocations(c, p, cents)
  const method = choice(p.method, METHODS, 'how the gift was paid'), reference = optional(p.reference, 'Reference', 100), fund = allocations.length ? allocations[0].fund : optional(p.fund, 'Fund', 100) ?? 'Unrestricted'
  const pledgeId = optional(p.pledgeId, 'Pledge', 100), g = benefit ? { kind: 'none', cents: 0, description: null } : goods(p, cents), note = optional(p.note, 'Note', 1000)
  const attribution = await entryAttribution(c, p, fund, allocations.length > 0)
  await commit(c, [
   guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)", 'NOT_FOUND', 'That donor does not exist.', donorId),
   ...(pledgeId ? [guard('EXISTS(SELECT 1 FROM cf_pledges WHERE id=? AND donor_id=?)', 'PLEDGE', 'That pledge belongs to another donor.', pledgeId, donorId)] : []),
   sql("INSERT INTO cf_gifts VALUES(?,1,?,'gift',NULL,?,?,?,?,?,?,?,?,?,?,'manual',?,?)", giftId, donorId, received, cents, method, reference, fund, pledgeId, g.kind, g.cents, g.description, note, c.now, c.actor.name),
   ...benefitStatements(giftId, benefit, s),
   ...giftAllocationStatements(giftId, allocations),
   ...attribution.statements(giftId),
   ...await giftInstallmentStatements(c, p, giftId, donorId, cents, pledgeId),
   event(c, 'gift.record', 'gift', giftId, donorId, { amountCents: cents, receivedOn: received, campaignId: attribution.campaignId, appeal: attribution.appeal, channel: attribution.channel, ...(allocations.length ? { allocations } : {}) })])
  return { id: giftId, amountCents: cents, campaignId: attribution.campaignId, appeal: attribution.appeal, channel: attribution.channel, ...(allocations.length ? { allocations } : {}) }
 }
 if (command === 'gift.reverse') {
  const giftId = id(p.giftId, 'Gift'), reason = text(p.reason, 'Reason', 300), reversalId = newId()
  const gift = await one(c, "SELECT * FROM cf_gifts WHERE id=? AND kind='gift'", giftId)
  if (!gift) fail('NOT_FOUND', 'That gift does not exist.', 404)
  const on = p.reversedOn ? date(p.reversedOn, 'Reversed on') : today((await settings(c)).timezone)
  if (on < gift.received_on) fail('INPUT', 'A reversal cannot be dated before its gift.', 400)
  await commit(c, [
   guard("NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=?)", 'ALREADY_REVERSED', 'This gift has already been reversed.', giftId),
   guard("NOT EXISTS(SELECT 1 FROM cf_payment_entries WHERE gift_id=? AND contribution_cents<>0)", 'PROCESSOR_ADJUSTMENT', 'Stripe has already adjusted this gift. Record further refunds in Stripe.', giftId),
   guard("NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=? AND a.live=1 AND b.status IN ('prepared','approved'))", 'IN_ACKNOWLEDGEMENT', 'Discard the acknowledgement batch holding this gift before reversing it.', giftId),
   sql("INSERT INTO cf_gifts VALUES(?,1,?,'reversal',?,?,?,?,NULL,?,?,'none',0,NULL,?,'manual',?,?)", reversalId, gift.donor_id, giftId, on, -gift.amount_cents, gift.method, gift.fund, gift.pledge_id, reason, c.now, c.actor.name),
   event(c, 'gift.reverse', 'gift', giftId, gift.donor_id, { amountCents: -gift.amount_cents, reversal: reversalId })])
  return { id: reversalId, reverses: giftId }
 }
 if (command === 'gift.classify') {
  const giftId = id(p.giftId, 'Gift'), version = integer(p.version, 'Version', 1)
  const gift = await one(c, "SELECT * FROM cf_gifts WHERE id=? AND kind='gift'", giftId)
  if (!gift) fail('NOT_FOUND', 'That gift does not exist.', 404)
  if (gift.goods !== 'unknown') fail('ALREADY_CLASSIFIED', 'This gift already records whether goods or services were provided.')
  const s = await settings(c), benefit = receiptBenefit(p, gift.amount_cents, gift.received_on, s)
  const g = benefit ? { kind: 'none', cents: 0, description: null } : goods(p, gift.amount_cents)
  await commit(c, [guard("EXISTS(SELECT 1 FROM cf_gifts WHERE id=? AND version=? AND goods='unknown')", 'VERSION', 'This gift changed. Refresh before saving.', giftId, version),
   sql('UPDATE cf_gifts SET version=version+1,goods=?,goods_cents=?,goods_description=? WHERE id=?', g.kind, g.cents, g.description, giftId),
   ...benefitStatements(giftId, benefit, s),
   event(c, 'gift.classify', 'gift', giftId, gift.donor_id, { goods: g.kind, goodsCents: g.cents })])
  return { id: giftId, version: version + 1 }
 }
 return undefined
}
