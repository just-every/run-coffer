import { all, date, fail, guard, id, newId, object, one, optional, sql, type Context, type Row, type Stmt } from './db'
import { amount } from './money'

export type GiftAllocation = { id: string; position: number; fund: string; campaignId: string | null; amountCents: number }

/** A split describes one received payment, never additional gifts or receipts. */
export async function prepareGiftAllocations(c: Context, p: Row, cents: number): Promise<GiftAllocation[]> {
 if (p.allocations === undefined) return []
 if (!Array.isArray(p.allocations) || p.allocations.length < 2 || p.allocations.length > 50) fail('INPUT', 'A split gift needs 2–50 allocations.', 400)
 if (optional(p.fund, 'Fund', 100)) fail('INPUT', 'Choose funds in the allocations instead of a payment-level fund.', 400)
 if (optional(p.pledgeId, 'Pledge', 100) || optional(p.installmentId, 'Installment', 100)) fail('PLEDGE_SPLIT', 'A split payment cannot be matched to a pledge or installment. Leave the pledge unmatched.', 400)
 const seen = new Set<string>(), rows: GiftAllocation[] = []
 let campaignMode: boolean | undefined
 for (const [index, raw] of p.allocations.entries()) {
  const part = object(raw, `Allocation ${index + 1}`), campaignId = optional(part.campaignId, 'Campaign', 100)
  if (campaignMode !== undefined && campaignMode !== Boolean(campaignId)) fail('INPUT', 'Split a payment across funds or across campaigns; use the same type for every allocation.', 400)
  campaignMode = Boolean(campaignId)
  let fund = optional(part.fund, `Allocation ${index + 1} fund`, 100)
  if (campaignId) {
   const campaign = await one(c, 'SELECT fund FROM cf_campaigns WHERE id=?', campaignId)
   if (!campaign) fail('INPUT', `Allocation ${index + 1} campaign does not exist.`, 400)
   if (fund && fund !== campaign.fund) fail('INPUT', `Allocation ${index + 1} must use its campaign’s fund.`, 400)
   fund = campaign.fund
  }
  if (!fund) fail('INPUT', `Choose a fund for allocation ${index + 1}.`, 400)
  const destination = campaignId ?? fund
  if (seen.has(destination)) fail('INPUT', 'Use each allocation destination once.', 400)
  seen.add(destination)
  rows.push({ id: newId(), position: index + 1, fund, campaignId, amountCents: amount(part, 'amount', `Allocation ${index + 1} amount`) })
 }
 if (rows.reduce((sum, row) => sum + row.amountCents, 0) !== cents) fail('INPUT', 'Allocation amounts must add up exactly to the payment amount.', 400)
 return rows
}

/** Append after the payment insert in its transaction. The final guard also
 * prevents incomplete allocations from becoming durable. */
export function giftAllocationStatements(giftId: string, allocations: GiftAllocation[]): Stmt[] {
 if (!allocations.length) return []
 return [
  ...allocations.flatMap(a => [
   ...(a.campaignId ? [guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)', 'CAMPAIGN_CHANGED', 'An allocation campaign changed. Refresh before saving.', a.campaignId, a.fund)] : []),
   sql('INSERT INTO cf_gift_allocations(id,gift_id,position,fund,campaign_id,amount_cents) VALUES(?,?,?,?,?,?)', a.id, giftId, a.position, a.fund, a.campaignId, a.amountCents),
  ]),
  guard('EXISTS(SELECT 1 FROM cf_gifts g WHERE g.id=? AND g.amount_cents=(SELECT SUM(amount_cents) FROM cf_gift_allocations WHERE gift_id=g.id))', 'ALLOCATION_TOTAL', 'Allocation amounts must add up exactly to the payment amount.', giftId),
 ]
}

/** Empty for an unsplit gift; original allocations also describe a reversal. */
export const giftAllocations = (c: { db: D1Database }, giftId: string): Promise<Row[]> => all(c, `SELECT a.*,c.name AS campaign FROM cf_gift_allocations a
 LEFT JOIN cf_campaigns c ON c.id=a.campaign_id WHERE a.gift_id=COALESCE((SELECT reverses FROM cf_gifts WHERE id=?),?) ORDER BY a.position`, giftId, giftId)

export async function fundTotals(c: { db: D1Database }, filters: { from?: string | null; through?: string | null; donorId?: string | null } = {}): Promise<Row[]> {
 const from = filters.from ? date(filters.from, 'From') : null, through = filters.through ? date(filters.through, 'Through') : null
 const donorId = filters.donorId ? id(filters.donorId, 'Donor') : null
 if (from && through && from > through) fail('INPUT', 'From must be on or before Through.', 400)
 return all(c, `SELECT fund,SUM(amount_cents) AS amount_cents,COUNT(DISTINCT CASE WHEN kind='gift' AND source<>'stripe-adjustment' THEN gift_id END) AS gift_count
 FROM cf_fund_ledger WHERE (? IS NULL OR received_on>=?) AND (? IS NULL OR received_on<=?) AND (? IS NULL OR donor_id=?) GROUP BY fund ORDER BY fund`, from, from, through, through, donorId, donorId)
}

/** Exact boundary apportionment for accounting gross and fees. BigInt avoids
 * floating-point rounding and overflow when multiplying large cent amounts. */
export function allocateCents(cents: number, allocations: Pick<GiftAllocation, 'amountCents'>[]): number[] {
 if (!Number.isSafeInteger(cents) || !allocations.length || allocations.some(a => !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0)) fail('ALLOCATION_AMOUNT', 'Accounting allocations require exact integer cents.', 400)
 const total = allocations.reduce((sum, a) => sum + BigInt(a.amountCents), 0n)
 let boundary = 0n, previous = 0n
 return allocations.map(a => {
  boundary += BigInt(a.amountCents)
  const next = BigInt(cents) * boundary / total, value = Number(next - previous)
  previous = next
  return value
 })
}

/** Preserve processor entry identity; expand only its accounting dimensions. */
export async function paymentFundLines(c: { db: D1Database }, lines: Row[]): Promise<Row[]> {
 const giftIds = [...new Set(lines.map(l => l.gift_id).filter(Boolean))]
 if (!giftIds.length) return lines
 const rows = await all(c, 'SELECT * FROM cf_gift_allocations WHERE gift_id IN (SELECT value FROM json_each(?)) ORDER BY gift_id,position', JSON.stringify(giftIds))
 if (!rows.length) return lines
 const entries = await all(c, 'SELECT * FROM cf_payment_entries WHERE gift_id IN (SELECT value FROM json_each(?)) ORDER BY gift_id,created_at,id', JSON.stringify([...new Set(rows.map(a => a.gift_id))]))
 const totals = new Map<string, { gross: number; fees: number }>(), allocated = new Map<string, Row[]>()
 // Difference cumulative boundaries, so many penny refunds return every fund
 // to zero rather than repeatedly assigning the rounding penny to one fund.
 for (const entry of entries) {
  const parts = rows.filter(a => a.gift_id === entry.gift_id), weights = parts.map(a => ({ amountCents: a.amount_cents }))
  const previous = totals.get(entry.gift_id) ?? { gross: 0, fees: 0 }
  const current = { gross: previous.gross + entry.amount_cents, fees: previous.fees + entry.fee_cents }
  const beforeGross = allocateCents(previous.gross, weights), beforeFees = allocateCents(previous.fees, weights)
  const afterGross = allocateCents(current.gross, weights), afterFees = allocateCents(current.fees, weights)
  allocated.set(entry.id, parts.map((a, i) => {
   const gross = afterGross[i] - beforeGross[i], fees = afterFees[i] - beforeFees[i]
   return { allocation_id: a.id, fund: a.fund, campaign_id: a.campaign_id, amount_cents: gross, fee_cents: fees, net_cents: gross - fees }
  }))
  totals.set(entry.gift_id, current)
 }
 return lines.flatMap(line => {
  if (!rows.some(a => a.gift_id === line.gift_id)) return [line]
  const parts = allocated.get(line.id)
  if (!parts) fail('ALLOCATION_ENTRY', 'A split accounting entry is missing from the payment ledger.')
  return parts.map(part => ({ ...line, ...part }))
 })
}

/** One bounded query for a record or receipt batch, keeping payment fund intact. */
export const allGiftAllocations = (c: {db:D1Database}, giftIds:string[]):Promise<Row[]> => all(c, `SELECT a.*,c.name AS campaign FROM cf_gift_allocations a LEFT JOIN cf_campaigns c ON c.id=a.campaign_id WHERE a.gift_id IN (SELECT value FROM json_each(?)) ORDER BY a.gift_id,a.position`,JSON.stringify(giftIds))
export async function receiptFundLabels(c: {db:D1Database},gifts:Row[]) {
 const allocations=await allGiftAllocations(c,gifts.map(g=>g.id))
 for(const gift of gifts){const parts=allocations.filter(a=>a.gift_id===gift.id);if(parts.length)gift.receipt_fund=parts.map(a=>`${a.fund}${a.campaign ? ` (${a.campaign})` : ''}: $${(a.amount_cents/100).toFixed(2)}`).join('; ')}
}
