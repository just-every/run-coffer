import { all, one, fail, type Context } from './db'
import { retentionScope } from './retention-scope'
import { longDate } from './settings'

export type RetentionKind = 'retained' | 'new' | 'lapsed' | 'recaptured'
export type RetentionRow = {
 donorId: string; name: string; priorCents: number; currentCents: number; lastGift: string | null
}
export type RetentionGroup = {
 kind: RetentionKind; rows: RetentionRow[]; count: number; priorCents: number; currentCents: number
}
export type SoftCreditRetentionRow = { donorId: string; name: string; priorCents: number; currentCents: number; creditCount: number }
const summarize = (rows: Pick<RetentionRow, 'priorCents' | 'currentCents'>[]) => ({
 count: rows.length,
 priorCents: rows.reduce((sum, row) => sum + row.priorCents, 0),
 currentCents: rows.reduce((sum, row) => sum + row.currentCents, 0),
})

/** Net contributions are attributed to their ledger dates, including refunds
 * and reversals. Fees and soft credits are not donor contributions. */
export async function retention(c: Context, url: URL) {
 const scope = await retentionScope(c,url)
 const {year,priorYear,asOf,start,priorStart,end,donorSql,donorParams,fund,campaignId} = scope
 // The same split-aware signed ledger scopes history, cohorts and reconciliation.
 const ledgerSql = `(? IS NULL OR fund=?) AND (? IS NULL OR campaign_id=?)`
 const ledgerParams = [fund,fund,campaignId,campaignId]
 const [donors, excluded, softCreditRows] = await Promise.all([
  all<RetentionRow & { earlierCents: number }>(c, `WITH ledger AS (SELECT * FROM cf_fund_ledger WHERE ${ledgerSql}), annual AS (
   SELECT donor_id,CAST(substr(received_on,1,4) AS INTEGER)-CASE WHEN substr(received_on,6)<'${scope.monthDay}' THEN 1 ELSE 0 END AS year,SUM(amount_cents) AS cents
   FROM ledger WHERE received_on<? GROUP BY donor_id,year
  ), periods AS (
   SELECT donor_id,SUM(CASE WHEN received_on>=? AND received_on<? THEN amount_cents ELSE 0 END) AS priorCents,
    SUM(CASE WHEN received_on>=? THEN amount_cents ELSE 0 END) AS currentCents
   FROM ledger WHERE received_on>=? AND received_on<=? GROUP BY donor_id
  ), last_gifts AS (
   SELECT donor_id,MAX(received_on) AS lastGift FROM cf_gift_balances WHERE net_cents>0 AND received_on<=? GROUP BY donor_id
  ) SELECT d.id AS donorId,d.name,p.priorCents,p.currentCents,g.lastGift,
   COALESCE((SELECT MAX(cents) FROM annual a WHERE a.donor_id=d.id),0) AS earlierCents
  FROM periods p JOIN cf_donors d ON d.id=p.donor_id LEFT JOIN cf_households h ON h.id=d.household_id LEFT JOIN last_gifts g ON g.donor_id=d.id
  WHERE ${donorSql} AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  ORDER BY lower(d.name),d.id`, ...ledgerParams,priorStart, priorStart, start, start, priorStart, end, end,...donorParams),
  all<{ priorCents: number; currentCents: number }>(c, `SELECT
   COALESCE(SUM(CASE WHEN l.received_on<? THEN l.amount_cents ELSE 0 END),0) AS priorCents,
   COALESCE(SUM(CASE WHEN l.received_on>=? THEN l.amount_cents ELSE 0 END),0) AS currentCents
   FROM (SELECT * FROM cf_fund_ledger WHERE ${ledgerSql}) l JOIN cf_donors d ON d.id=l.donor_id LEFT JOIN cf_households h ON h.id=d.household_id
   WHERE l.received_on>=? AND l.received_on<=? AND ${donorSql} AND (d.erased_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, start, start,...ledgerParams,priorStart,end,...donorParams),
  all<SoftCreditRetentionRow>(c, `SELECT credited.id AS donorId,credited.name,COUNT(*) AS creditCount,
   SUM(CASE WHEN g.received_on<? THEN MIN(s.amount_cents,g.net_cents) ELSE 0 END) AS priorCents,
   SUM(CASE WHEN g.received_on>=? THEN MIN(s.amount_cents,g.net_cents) ELSE 0 END) AS currentCents
   FROM cf_soft_credits s JOIN cf_gift_balances g ON g.id=s.gift_id
   JOIN cf_donors credited ON credited.id=s.donor_id JOIN cf_donors hard ON hard.id=g.donor_id
   JOIN cf_donors d ON d.id=credited.id LEFT JOIN cf_households h ON h.id=d.household_id
   WHERE g.received_on>=? AND g.received_on<=? AND g.kind='gift' AND g.net_cents>0
    AND ${donorSql} AND hard.erased_at IS NULL AND credited.erased_at IS NULL
    AND EXISTS(SELECT 1 FROM cf_fund_ledger l WHERE l.gift_id=g.id AND (? IS NULL OR l.fund=?) AND (? IS NULL OR l.campaign_id=?))
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id IN (hard.id,credited.id))
    AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
   GROUP BY credited.id,credited.name ORDER BY lower(credited.name),credited.id`, start,start,priorStart,end,...donorParams,...ledgerParams),
 ])
 if(!(await one(c,`SELECT ${scope.scoreCurrentSql} AS current`))?.current)fail('LIST_CHANGED','Giving or engagement facts changed. Refresh this report.',409)
 const groups: Record<RetentionKind, RetentionGroup> = {
  retained: { kind: 'retained', rows: [], count: 0, priorCents: 0, currentCents: 0 },
  new: { kind: 'new', rows: [], count: 0, priorCents: 0, currentCents: 0 },
  lapsed: { kind: 'lapsed', rows: [], count: 0, priorCents: 0, currentCents: 0 },
  recaptured: { kind: 'recaptured', rows: [], count: 0, priorCents: 0, currentCents: 0 },
 }
 const adjustmentRows: RetentionRow[] = []
 for (const donor of donors) {
  const { earlierCents, ...row } = donor
  const kind = row.currentCents > 0
   ? row.priorCents > 0 ? 'retained' : earlierCents > 0 ? 'recaptured' : 'new'
   : row.priorCents > 0 ? 'lapsed' : null
  if (kind) groups[kind].rows.push(row)
  else adjustmentRows.push(row)
 }
 for (const group of Object.values(groups)) Object.assign(group, summarize(group.rows))
 const movements = Object.fromEntries((['upgraded','downgraded','unchanged'] as const).map(kind=>{
  const rows = groups.retained.rows.filter(r=>kind==='upgraded' ? r.currentCents>r.priorCents : kind==='downgraded' ? r.currentCents<r.priorCents : r.currentCents===r.priorCents)
  return [kind,{kind,rows,...summarize(rows),changeCents:rows.reduce((n,r)=>n+r.currentCents-r.priorCents,0)}]
 }))
 const totals = summarize(donors), excludedTotals = excluded[0]
 const priorDonors = groups.retained.count + groups.lapsed.count
 const currentDonors = groups.retained.count + groups.new.count + groups.recaptured.count
 return {
  year, priorYear, asOf, timezone:scope.timezone,basis:scope.basis,
  filters:{volunteer:scope.volunteer,fund,campaignId,list:scope.savedId?'saved:'+scope.savedId:scope.list,listYear:scope.listYear,q:scope.q,relationship:scope.relationship,relatedTo:scope.relatedTo},
  prior: { from: priorStart, through: scope.priorEnd, label: `${priorYear} complete ${scope.basis} year` },
  current: { from: start, through: end, provisional: year===scope.currentYear, label: year === scope.currentYear ? `${year} year to date through ${longDate(end)}` : `${year} complete ${scope.basis} year` },
  groups, movements, adjustments: { rows: adjustmentRows, ...summarize(adjustmentRows) },
  softCredits: { rows: softCreditRows, ...summarize(softCreditRows) },
  totals: { ...totals, priorDonors, currentDonors, retentionRate: priorDonors ? groups.retained.count / priorDonors : null },
  excluded: excludedTotals,
  ledgerTotals: { priorCents: totals.priorCents + excludedTotals.priorCents, currentCents: totals.currentCents + excludedTotals.currentCents },
 }
}
