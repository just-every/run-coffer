import { addDays, all, today, type Context } from './db'
import { settings } from './settings'

export type LapseKind = 'lybunt' | 'sybunt' | 'monthly'
export type LapseRow = {
 key: string; sourceKey: string; donorId: string; name: string; reason: string; amountCents: number
 kind: LapseKind; lastGift: string | null; sourceId?: string; referenceYear?: number; monthlyCents?: number
}
type AnnualDonor = { donorId: string; name: string; priorCents: number; currentCents: number; referenceYear: string; referenceCents: number; lastGift: string | null }
type Plan = { id: string; donorId: string; name: string; amountCents: number; status: string; lastGift: string | null }
export const MONTHLY_LAPSE_DAYS = 45

/** Each donor's ordinary annual lapse is suppressed when a stopped monthly
 * plan is listed. Multiple stopped plans remain separate financial commitments. */
export async function lapses(c: Context) {
 const s = await settings(c), asOf = today(s.timezone, new Date(c.now)), year = Number(asOf.slice(0, 4))
 const [donors, plans] = await Promise.all([
  all<AnnualDonor>(c, `WITH annual AS (
   SELECT donor_id,substr(received_on,1,4) AS year,SUM(amount_cents) AS cents
   FROM cf_contribution_ledger WHERE received_on<=? GROUP BY donor_id,substr(received_on,1,4)
  ), latest AS (
   SELECT donor_id,MAX(year) AS year FROM annual WHERE year<? AND cents>0 GROUP BY donor_id
  ), last_gifts AS (
   SELECT donor_id,MAX(received_on) AS lastGift FROM cf_gift_balances WHERE net_cents>0 AND received_on<=? GROUP BY donor_id
  ) SELECT d.id AS donorId,d.name,COALESCE(prior.cents,0) AS priorCents,COALESCE(current.cents,0) AS currentCents,
    a.year AS referenceYear,a.cents AS referenceCents,g.lastGift
   FROM latest l JOIN annual a ON a.donor_id=l.donor_id AND a.year=l.year
   JOIN cf_donors d ON d.id=l.donor_id
   LEFT JOIN annual prior ON prior.donor_id=d.id AND prior.year=?
   LEFT JOIN annual current ON current.donor_id=d.id AND current.year=?
   LEFT JOIN last_gifts g ON g.donor_id=d.id
   WHERE d.erased_at IS NULL AND COALESCE(current.cents,0)<=0
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
   ORDER BY lower(d.name),d.id`, asOf, String(year), asOf, String(year - 1), String(year)),
  all<Plan>(c, `SELECT s.id,s.donor_id AS donorId,d.name,s.amount_cents AS amountCents,s.status,
   MAX(CASE WHEN g.net_cents>0 AND g.received_on<=? THEN g.received_on END) AS lastGift
   FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id
   LEFT JOIN cf_subscription_gifts x ON x.subscription_id=s.id
   LEFT JOIN cf_gift_balances g ON g.id=x.gift_id AND g.donor_id=s.donor_id
   WHERE d.erased_at IS NULL AND s.amount_cents>0
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
   GROUP BY s.id ORDER BY lower(d.name),s.id`, asOf),
 ])
 const rows: LapseRow[] = [], monthlyDonors = new Set<string>()
 for (const plan of plans) {
  const stopped = ['past_due', 'unpaid', 'canceled'].includes(plan.status)
  const overdue = plan.lastGift !== null && addDays(plan.lastGift, MONTHLY_LAPSE_DAYS) < asOf
  if (!stopped && !overdue) continue
  const key = `monthly:${plan.id}:${plan.lastGift ?? 'unknown'}`
  rows.push({ key, sourceKey: key, kind: 'monthly', sourceId: plan.id, donorId: plan.donorId, name: plan.name,
   lastGift: plan.lastGift, monthlyCents: plan.amountCents, amountCents: plan.amountCents * 12,
   reason: `${stopped ? `Monthly plan status is ${plan.status}. ` : ''}${plan.lastGift
    ? `Last linked gift with a positive balance was ${plan.lastGift}.${overdue ? ' More than 45 days have passed without another net gift on this plan.' : ''}`
    : 'Last paid date is unknown: no linked gift with a positive balance is recorded; status is the evidence.'}`,
  })
  monthlyDonors.add(plan.donorId)
 }
 let suppressedAnnualCount = 0
 for (const donor of donors) {
  if (monthlyDonors.has(donor.donorId)) { suppressedAnnualCount++; continue }
  const kind = donor.priorCents > 0 ? 'lybunt' : 'sybunt', referenceYear = Number(donor.referenceYear)
  const key = `${kind}:${year}:${donor.donorId}`
  rows.push({ key, sourceKey: key, donorId: donor.donorId, name: donor.name, kind, lastGift: donor.lastGift, referenceYear,
   amountCents: donor.priorCents > 0 ? donor.priorCents : donor.referenceCents,
   reason: kind === 'lybunt'
    ? `Positive net giving in ${year - 1}; no positive net giving in ${year} through ${asOf} (LYBUNT).`
    : `Last positive net giving year was ${referenceYear}; no positive net giving in ${year - 1} or ${year} through ${asOf} (SYBUNT).`,
  })
 }
 rows.sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
 const groups = (['lybunt', 'sybunt', 'monthly'] as const).map(kind => {
  const members = rows.filter(row => row.kind === kind)
  return { kind, rows: members, count: members.length, donorCount: new Set(members.map(row => row.donorId)).size, amountCents: members.reduce((sum, row) => sum + row.amountCents, 0) }
 })
 return { asOf, year, timezone: s.timezone, rows, groups, suppressedAnnualCount,
  policy: 'Monthly plans expect a gift every month. Allow up to 31 days plus 14 days of grace (45 days). Flag linked gifts after that window, or past_due, unpaid or canceled status. Unlinked legacy plans are flagged only by those statuses. Risk is 12 monthly installments, or the most recent positive annual net giving for annual lapses; it is a reference amount, not money owed. Annual lapses for donors with a flagged monthly plan are excluded from the total.',
  totals: { count: rows.length, donorCount: new Set(rows.map(row => row.donorId)).size, amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0) },
 }
}
