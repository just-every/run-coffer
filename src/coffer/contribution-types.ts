import { requireRole } from './auth'
import { all, choice, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, text, today, type Context, type Row } from './db'
import { prepareGiftRecord } from './gifts'
import { IN_KIND_GOODS } from './in-kind'
import { amount } from './money'
import { settings } from './settings'

/** Six-place decimals become exact scaled integers before market arithmetic. */
function decimal(value: unknown, label: string) {
 const raw = typeof value === 'string' ? value.trim() : ''
 if (!/^\d{1,9}(\.\d{1,6})?$/.test(raw)) fail('INPUT', `${label} must be positive with at most six decimal places.`, 400)
 const [whole, fraction = ''] = raw.split('.')
 const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
 if (micros <= 0n) fail('INPUT', `${label} must be more than zero.`, 400)
 return { raw, micros }
}
const live = (donorId: string) => guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)', 'DONOR_CHANGED', 'Choose a current donor.', donorId, donorId)

/** Stock remains property with zero monetary cents; DAF/QCD remain ordinary
 * monetary lines. All subtype metadata is committed with its original gift. */
export async function contributionTypeCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['contribution.record', 'contribution.stockSale'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'record contribution types')
 const donorId = id(p.donorId, 'Donor'), s = await settings(c), day = today(s.timezone, new Date(c.now))
 if (command === 'contribution.stockSale') {
  const giftId = id(p.inKindId, 'Stock gift'), version = integer(Number(p.version), 'Stock version', 1)
  const stock = await one(c, 'SELECT s.*,g.version AS property_record_version,g.received_on FROM cf_stock_contributions s JOIN cf_in_kind_gifts g ON g.id=s.in_kind_id WHERE s.in_kind_id=? AND g.donor_id=?', giftId, donorId)
  if (!stock) fail('NOT_FOUND', 'That stock gift does not exist on this donor.', 404)
  const soldOn = date(p.soldOn, 'Sale date'), proceeds = amount(p, 'saleProceeds', 'Sale proceeds', { allowZero: true })
  if (soldOn < stock.transfer_on || soldOn > day) fail('INPUT', 'Sale date must be on or after transfer and no later than today.', 400)
  await commit(c, [live(donorId),
   guard('EXISTS(SELECT 1 FROM cf_stock_contributions WHERE in_kind_id=? AND version=? AND sold_on IS NULL)', 'VERSION', 'This stock gift changed or has already been sold.', giftId, version),
   guard('EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=? AND donor_id=? AND version=? AND disposed_on IS NULL)', 'PROPERTY_CHANGED', 'The property record changed. Refresh before recording its sale.', giftId, donorId, stock.property_record_version),
   sql('UPDATE cf_stock_contributions SET version=version+1,sold_on=?,sale_proceeds_cents=? WHERE in_kind_id=?', soldOn, proceeds, giftId),
   sql("UPDATE cf_in_kind_gifts SET disposed_on=?,disposal_method='sold',disposal_exception='none',disposal_evidence='Sale proceeds recorded in the stock register.',version=version+1,updated_at=? WHERE id=?", soldOn, c.now, giftId),
   event(c, command, 'stock_contribution', giftId, donorId, { soldOn, saleProceedsCents: proceeds, version: version + 1 }),
  ])
  return { id: giftId, donorId, version: version + 1, soldOn, saleProceedsCents: proceeds }
 }
 const kind = text(p.kind, 'Contribution type', 20)
 if (!['stock', 'daf', 'qcd'].includes(kind)) fail('INPUT', 'Choose stock, daf or qcd.', 400)
 if (p.giftId || p.inKindId) fail('INPUT', 'Record a new contribution; an existing gift cannot be reclassified here.', 400)
 const receivedOn = date(p.receivedOn, kind === 'stock' ? 'Transfer date' : 'Received on')
 if (receivedOn > day) fail('INPUT', 'Record a contribution already received, no later than today.', 400)
 if (kind === 'stock') {
  const symbol = text(p.symbol, 'Publicly traded security symbol', 15).toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) fail('INPUT', 'Enter the publicly traded security’s symbol.', 400)
  const shares = decimal(p.shares, 'Shares'), high = decimal(p.highPrice, 'Transfer-day high price per share'), low = decimal(p.lowPrice, 'Transfer-day low price per share')
  if (low.micros > high.micros) fail('INPUT', 'The low price cannot exceed the high price.', 400)
  // shares × ((high + low)/2), rounded half-up once to total USD cents.
  const denominator = 20000000000n, numerator = shares.micros * (high.micros + low.micros)
  const value = Number((numerator + denominator / 2n) / denominator)
  amount({ valueCents: value }, 'value', 'Recorded stock value', { allowZero: true })
  const giftId = newId(), fund = optional(p.fund, 'Fund', 100) ?? 'Unrestricted'
  const description = `Publicly traded securities: ${shares.raw} shares of ${symbol}.`
  const goods = choice(p.goods ?? 'none', IN_KIND_GOODS, 'Goods or services')
  const goodsDescription = goods === 'provided' ? longText(p.goodsDescription, 'Goods or services description', 1000) : null
  const goodsCents = goods === 'provided' ? amount(p, 'goodsValue', 'Good faith goods value', { allowZero: true }) : 0
  if (goods === 'intangible religious benefits' && !s.religious_organization) fail('RELIGIOUS_ORGANIZATION', 'Review the exclusively religious organization setting first.')
  await commit(c, [live(donorId),
   sql(`INSERT INTO cf_in_kind_gifts(id,donor_id,description,quantity,stated_value_cents,received_on,original_received_on,goods,goods_cents,goods_description,form_8283,created_at,updated_at,created_by,fund)
    VALUES(?,?,?,?,?,?,?,?,?,?,'not_section_b',?,?,?,?)`, giftId, donorId, description, shares.raw, value, receivedOn, receivedOn, goods, goodsCents, goodsDescription, c.now, c.now, c.actor.id, fund),
   sql('INSERT INTO cf_stock_contributions(in_kind_id,version,symbol,shares,transfer_on,high_price_micros,low_price_micros,recorded_value_cents,created_at,created_by) VALUES(?,1,?,?,?,?,?,?,?,?)', giftId, symbol, shares.raw, receivedOn, Number(high.micros), Number(low.micros), value, c.now, c.actor.id),
   event(c, command, 'stock_contribution', giftId, donorId, { kind, recordedValueCents: value }),
  ])
  return { id: giftId, donorId, kind, version: 1, recordedValueCents: value, valuationBasis: 'market_high_low_mean' }
 }
 // Neither a DAF sponsor grant nor a QCD is a purchase of donor benefits.
 if ((p.goods && p.goods !== 'none') || (p.benefit && p.benefit !== 'none')) fail('INPUT', 'These contribution types require no goods or services.', 400)
 const prepared = await prepareGiftRecord(c, { ...p, receivedOn, goods: 'none', benefit: undefined })
 const giftId = prepared.result.id, creditId = kind === 'daf' ? newId() : null
 const custodian = kind === 'qcd' ? text(p.custodian, 'IRA custodian', 200) : null
 const advisorId = kind === 'daf' ? id(p.advisorDonorId, 'DAF advisor') : null
 await commit(c, [...prepared.statements,
  ...(advisorId ? [
   guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND constituent_kind='organization' AND erased_at IS NULL)", 'DAF_SPONSOR', 'Hard credit a DAF sponsor organization.', donorId),
   live(advisorId), guard('?', 'DAF_ADVISOR', 'Choose an advisor different from the sponsor.', advisorId !== donorId ? 1 : 0),
   sql('INSERT INTO cf_soft_credits VALUES(?,?,?,?,?,?)', creditId, giftId, advisorId, prepared.result.amountCents, c.now, c.actor.name),
  ] : []),
  sql('INSERT INTO cf_contribution_types VALUES(?,?,?,?,?,?)', giftId, kind, custodian, creditId, c.now, c.actor.id),
  event(c, command, 'contribution', giftId, donorId, { kind, amountCents: prepared.result.amountCents }),
 ])
 return { ...prepared.result, donorId, kind, ...(advisorId ? { advisorDonorId: advisorId, softCreditId: creditId } : {}) }
}

/** Attach classification before receipt selection/rendering, including a
 * reversal’s original. No advisor identity is merged into sponsor receipts. */
export async function withContributionTypes(c: { db: D1Database }, gifts: Row[]) {
 if (!gifts.length) return gifts
 const ids = JSON.stringify(gifts.map(g => g.reverses ?? g.property_id ?? g.id))
 const [monetary, stock] = await Promise.all([
  all(c, 'SELECT * FROM cf_contribution_types WHERE gift_id IN (SELECT value FROM json_each(?))', ids),
  all(c, 'SELECT * FROM cf_stock_contributions WHERE in_kind_id IN (SELECT value FROM json_each(?))', ids),
 ])
 for (const gift of gifts) {
  const key = gift.reverses ?? gift.property_id ?? gift.id
  const facts = monetary.find(r => r.gift_id === key) ?? stock.find(r => r.in_kind_id === key)
  if (!facts) continue
  gift.contribution_type = facts.kind ?? 'stock'
  gift.contribution_details = facts
  if (facts.kind === 'qcd') gift.qcd_custodian = facts.custodian
  if (!facts.kind) gift.valuation_basis = 'market_high_low_mean'
 }
 return gifts
}

export async function contributionTypeState(c: { db: D1Database }, donorId: string) {
 const [monetary, stocks] = await Promise.all([
  all(c, `SELECT t.*,g.donor_id,g.received_on,g.amount_cents,g.fund,b.net_cents,s.donor_id AS advisor_donor_id,a.name AS advisor_name
   FROM cf_contribution_types t JOIN cf_gifts g ON g.id=t.gift_id JOIN cf_gift_balances b ON b.id=g.id JOIN cf_donors d ON d.id=g.donor_id
   LEFT JOIN cf_soft_credits s ON s.id=t.soft_credit_id LEFT JOIN cf_donors a ON a.id=s.donor_id AND a.erased_at IS NULL
   WHERE g.donor_id=? AND d.erased_at IS NULL ORDER BY g.received_on DESC,g.id`, donorId),
  all(c, `SELECT s.*,g.donor_id,g.fund,g.version AS property_record_version,g.property_version,g.disposed_on FROM cf_stock_contributions s
   JOIN cf_in_kind_gifts g ON g.id=s.in_kind_id JOIN cf_donors d ON d.id=g.donor_id WHERE g.donor_id=? AND d.erased_at IS NULL ORDER BY s.transfer_on DESC,s.in_kind_id`, donorId),
 ])
 return { monetary, stocks: stocks.map(s => ({ ...s, valuationBasis: 'market_high_low_mean', monetaryCents: 0 })) }
}
