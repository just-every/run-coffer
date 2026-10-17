import { all, fail, integer, today, type Context } from './db'
import { settings } from './settings'

export type RetentionKind = 'retained' | 'new' | 'lapsed' | 'recaptured'
export type RetentionRow = {
 donorId: string; name: string; priorCents: number; currentCents: number; lastGift: string | null
}
export type RetentionGroup = {
 kind: RetentionKind; rows: RetentionRow[]; count: number; priorCents: number; currentCents: number
}
const summarize = (rows: RetentionRow[]) => ({
 count: rows.length,
 priorCents: rows.reduce((sum, row) => sum + row.priorCents, 0),
 currentCents: rows.reduce((sum, row) => sum + row.currentCents, 0),
})

/** Net contributions are attributed to their ledger dates, including refunds
 * and reversals. Fees and soft credits are not donor contributions. */
export async function retention(c: Context, selectedYear?: number | string) {
 const s = await settings(c), asOf = today(s.timezone, new Date(c.now)), currentYear = Number(asOf.slice(0, 4))
 if (typeof selectedYear === 'string' && !/^\d{4}$/.test(selectedYear)) fail('INPUT', 'Choose a calendar year.', 400)
 const year = integer(selectedYear === undefined ? currentYear : Number(selectedYear), 'Calendar year', 1000, currentYear)
 const priorYear = year - 1, priorStart = `${priorYear}-01-01`, start = `${year}-01-01`
 const end = year === currentYear ? asOf : `${year}-12-31`
 const [donors, excluded] = await Promise.all([
  all<RetentionRow & { earlierCents: number }>(c, `WITH annual AS (
   SELECT donor_id,substr(received_on,1,4) AS year,SUM(amount_cents) AS cents
   FROM cf_contribution_ledger WHERE received_on<? GROUP BY donor_id,substr(received_on,1,4)
  ), periods AS (
   SELECT donor_id,SUM(CASE WHEN received_on>=? AND received_on<? THEN amount_cents ELSE 0 END) AS priorCents,
    SUM(CASE WHEN received_on>=? THEN amount_cents ELSE 0 END) AS currentCents
   FROM cf_contribution_ledger WHERE received_on>=? AND received_on<=? GROUP BY donor_id
  ), last_gifts AS (
   SELECT donor_id,MAX(received_on) AS lastGift FROM cf_gift_balances WHERE net_cents>0 AND received_on<=? GROUP BY donor_id
  ) SELECT d.id AS donorId,d.name,p.priorCents,p.currentCents,g.lastGift,
   COALESCE((SELECT MAX(cents) FROM annual a WHERE a.donor_id=d.id),0) AS earlierCents
  FROM periods p JOIN cf_donors d ON d.id=p.donor_id LEFT JOIN last_gifts g ON g.donor_id=d.id
  WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  ORDER BY lower(d.name),d.id`, priorStart, priorStart, start, start, priorStart, end, end),
  all<{ priorCents: number; currentCents: number }>(c, `SELECT
   COALESCE(SUM(CASE WHEN l.received_on<? THEN l.amount_cents ELSE 0 END),0) AS priorCents,
   COALESCE(SUM(CASE WHEN l.received_on>=? THEN l.amount_cents ELSE 0 END),0) AS currentCents
   FROM cf_contribution_ledger l JOIN cf_donors d ON d.id=l.donor_id
   WHERE l.received_on>=? AND l.received_on<=? AND (d.erased_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, start, start, priorStart, end),
 ])
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
 const totals = summarize(donors), excludedTotals = excluded[0]
 const priorDonors = groups.retained.count + groups.lapsed.count
 const currentDonors = groups.retained.count + groups.new.count + groups.recaptured.count
 return {
  year, priorYear, asOf, timezone: s.timezone,
  prior: { from: priorStart, through: `${priorYear}-12-31`, label: `${priorYear} complete calendar year` },
  current: { from: start, through: end, label: year === currentYear ? `${year} year to date through ${end}` : `${year} complete calendar year` },
  groups, adjustments: { rows: adjustmentRows, ...summarize(adjustmentRows) },
  totals: { ...totals, priorDonors, currentDonors, retentionRate: priorDonors ? groups.retained.count / priorDonors : null },
  excluded: excludedTotals,
  ledgerTotals: { priorCents: totals.priorCents + excludedTotals.priorCents, currentCents: totals.currentCents + excludedTotals.currentCents },
 }
}
