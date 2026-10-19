import { all, integer, today, type Context } from './db'
import { settings } from './settings'

type AnnualDonor = { donorId: string; name: string; priorCents: number; currentCents: number; referenceYear: string; referenceCents: number; lastGift: string | null; lastGiftCents: number | null }

/** Annual re-engagement lists are independent of monthly-plan call risk. */
export async function annualLapses(c: Context, requestedYear?: number) {
 const timezone = (await settings(c)).timezone, day = today(timezone, new Date(c.now))
 const year = integer(requestedYear ?? Number(day.slice(0, 4)), 'Year', 1900, Number(day.slice(0, 4)))
 const through = year === Number(day.slice(0, 4)) ? day : `${year}-12-31`
 const rows = await all<AnnualDonor>(c, `WITH annual AS (
  SELECT donor_id,substr(received_on,1,4) AS year,SUM(amount_cents) AS cents
  FROM cf_monetary_contributions WHERE received_on<=? GROUP BY donor_id,substr(received_on,1,4)
 ), last_year AS (
  SELECT donor_id,MAX(year) AS year FROM annual WHERE year<? AND cents>0 GROUP BY donor_id
 ) SELECT d.id AS donorId,d.name,COALESCE(prior.cents,0) AS priorCents,
  COALESCE(current.cents,0) AS currentCents,a.year AS referenceYear,a.cents AS referenceCents,
  g.received_on AS lastGift,g.net_cents AS lastGiftCents
 FROM last_year l JOIN annual a ON a.donor_id=l.donor_id AND a.year=l.year
 JOIN cf_donors d ON d.id=l.donor_id
 LEFT JOIN annual prior ON prior.donor_id=d.id AND prior.year=?
 LEFT JOIN annual current ON current.donor_id=d.id AND current.year=?
 LEFT JOIN cf_gift_balances g ON g.id=(SELECT last.id FROM cf_gift_balances last
  WHERE last.donor_id=d.id AND last.net_cents>0 AND last.received_on<=?
  ORDER BY last.received_on DESC,last.created_at DESC,last.id DESC LIMIT 1)
 WHERE d.erased_at IS NULL AND COALESCE(current.cents,0)<=0
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
 ORDER BY lower(d.name),d.id`, through, String(year), String(year-1), String(year), through)
 const groups = (['lybunt','sybunt'] as const).map(kind => {
  const members = rows.filter(r => kind === 'sybunt' || r.priorCents > 0).map(r => ({...r,
   referenceYear:Number(r.referenceYear), kind, key: `${kind}:${year}:${r.donorId}`, sourceKey: `${kind}:${year}:${r.donorId}`,
   amountCents: kind === 'lybunt' ? r.priorCents : r.referenceCents,
   reason: kind === 'lybunt' ? `Positive net giving in ${year-1}; none in ${year} through ${through}.`
    : `Positive net giving in an earlier year; none in ${year} through ${through}.`,
  }))
  return {kind,rows:members,count:members.length,amountCents:members.reduce((n,r)=>n+r.amountCents,0)}
 })
 return {year,through,asOf:day,timezone,groups,policy:'Calendar-year signed net giving through the selected year end, or today for the current year. LYBUNT is positive net giving last year and none this year. SYBUNT is positive net giving in any earlier year and none this year, including LYBUNT. Monthly-plan flags do not remove anyone from these lists. Last gift shows its current positive balance separately from the reference-year total.'}
}
