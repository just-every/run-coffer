import { all, fail, id, type Row } from '../db'
import { paymentFundLines } from '../gift-splits'

export type FeeTotals = { gross_cents: number; fee_cents: number; net_cents: number }
export type FeeGroup = FeeTotals & { id: string | null; name: string }
const total = () => ({ gross_cents: 0, fee_cents: 0, net_cents: 0 })
function add(sum: ReturnType<typeof total>, line: Row) {
 sum.gross_cents += line.amount_cents; sum.fee_cents += line.fee_cents; sum.net_cents += line.net_cents
}
function group(lines: Row[], key: string, name: string, missing: string) {
 const groups = new Map<string, FeeGroup>()
 for (const line of lines) {
  const value = line[key] ?? '', row = groups.get(value) ?? { id: value || null, name: line[name] ?? missing, ...total() }
  add(row, line); groups.set(value, row)
 }
 return [...groups.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** Every balance line belongs once, including adjustments and later refunds.
 * Attribution comes from the recorded gift/form, never guessed from its fund.
 * Split gross and fees use the same cumulative cent boundaries as payouts. */
export async function feeReport(c: { db: D1Database }, payoutId?: string | null) {
 if (payoutId) id(payoutId, 'Payout ID')
 const payouts = await all(c, 'SELECT p.*,COALESCE(SUM(e.net_cents),0) AS matched_cents FROM cf_payouts p LEFT JOIN cf_payout_entries x ON x.payout_id=p.id LEFT JOIN cf_payment_entries e ON e.id=x.entry_id WHERE (? IS NULL OR p.id=?) GROUP BY p.id ORDER BY p.arrival_on,p.id', payoutId ?? null, payoutId ?? null)
 if (payoutId && !payouts.length) fail('not_found', 'That payout is not available.', 404)
 const raw = await all(c, `SELECT e.*,x.payout_id,cg.campaign_id AS gift_campaign_id,f.form_id,fc.name AS form_name
  FROM cf_payment_entries e LEFT JOIN cf_payout_entries x ON x.entry_id=e.id
  LEFT JOIN cf_campaign_gifts cg ON cg.gift_id=e.gift_id
  LEFT JOIN cf_dashboard_gift_forms f ON f.gift_id=e.gift_id LEFT JOIN cf_campaigns fc ON fc.id=f.form_id
  WHERE (? IS NULL OR x.payout_id=?) ORDER BY e.created_at,e.id`, payoutId ?? null, payoutId ?? null)
 const campaigns = await all(c, 'SELECT id,name FROM cf_campaigns')
 const lines: Row[] = (await paymentFundLines(c, raw)).map(line => {
  const campaignId = line.allocation_id ? line.campaign_id : line.gift_campaign_id
  return { ...line, campaign_id: campaignId ?? null, campaign_name: campaigns.find(c => c.id === campaignId)?.name ?? null }
 })
 const totals = total(), matched = total(), unmatched = total()
 for (const line of lines) { add(totals, line); add(line.payout_id ? matched : unmatched, line) }
 const reconciliation: Row[] = payouts.map(p => ({ ...p, difference_cents: p.amount_cents - p.matched_cents }))
 return {
  totals, matched, unmatched,
  byFund: group(lines, 'fund', 'fund', 'Processor adjustments'),
  byForm: group(lines, 'form_id', 'form_name', 'No recorded giving form'),
  byCampaign: group(lines, 'campaign_id', 'campaign_name', 'No campaign'),
  payouts: reconciliation,
  lines,
 }
}
