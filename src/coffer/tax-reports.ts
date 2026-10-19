import { requireRole } from './auth'
import { addDays, all, choice, commit, date, event, fail, guard, integer, one, sql, today, type Context, type Row } from './db'
import { fiscalPeriod } from './giving-summary'
import { settings } from './settings'
import { amount } from './money'

const SOURCES = {
 scheduleB: 'https://www.irs.gov/instructions/i990sb',
 scheduleA: 'https://www.irs.gov/instructions/i990sa',
 scheduleM: 'https://www.irs.gov/pub/irs-pdf/f990sm.pdf',
}
const RULES = ['general', 'public_support'] as const
type Rule = typeof RULES[number]
type Policy = { version: number; rule: Rule; updatedAt: string | null; denominator: { start: string; through: string; cents: number } | null }
const sum = (values: number[]) => integer(values.reduce((total, value) => total + value, 0), 'Report total', -Number.MAX_SAFE_INTEGER)

async function policy(c: { db: D1Database }): Promise<Policy> {
 const row = await one(c, 'SELECT * FROM cf_tax_report_settings WHERE id=1')
 if (!row) fail('STORAGE', 'Tax report settings have not been initialized.', 503)
 return { version: row.version, rule: row.schedule_b_rule, updatedAt: row.updated_at,
  denominator: row.denominator_cents === null ? null : { start: row.denominator_start, through: row.denominator_through, cents: row.denominator_cents } }
}

export async function taxReportCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'taxReports.settings') return undefined
 requireRole(c.actor, ['owner', 'admin'], 'change tax report settings')
 const version = integer(Number(p.version), 'Tax report settings version', 1)
 const rule = choice(p.rule, RULES, 'Schedule B rule')
 if (rule === 'public_support' && p.eligibilityConfirmed !== true && p.eligibilityConfirmed !== 'yes') {
  fail('INPUT', 'Confirm with your accountant that the organization qualifies for the Schedule B 33⅓% public-support special rule.', 400)
 }
 const denominator = rule === 'public_support' ? { start: date(p.periodStart, 'Denominator period start'), through: date(p.periodThrough, 'Denominator period end'), cents: amount(p, 'totalContributions', 'Form 990 Part VIII line 1h total', { allowZero: true }) } : null
 if (denominator && denominator.start > denominator.through) fail('INPUT', 'Denominator period end must follow its start.', 400)
 await commit(c, [
  guard('EXISTS(SELECT 1 FROM cf_tax_report_settings WHERE id=1 AND version=?)', 'VERSION', 'Tax report settings changed. Refresh before saving.', version),
  sql('UPDATE cf_tax_report_settings SET version=version+1,schedule_b_rule=?,denominator_start=?,denominator_through=?,denominator_cents=?,updated_at=?,updated_by=? WHERE id=1', rule, denominator?.start ?? null, denominator?.through ?? null, denominator?.cents ?? null, c.now, c.actor.id),
  event(c, command, 'tax_report_settings', '1', null, { version: version + 1, rule, denominator, eligibilityConfirmed: rule === 'public_support' }),
 ])
 return policy(c)
}

type Annual = { donorId: string | null; name: string; address: string[]; year: number; monetaryCents: number; noncashStatedCents: number; ledgerEntries: number }

/** Numeric working papers from received monetary ledger entries and the current
 * property register. Nothing here determines return accounting or tax status. */
export async function taxReport(c: Context, url: URL) {
 const [s, configuration] = await Promise.all([settings(c), policy(c)])
 const asOf = today(s.timezone, new Date(c.now))
 const basis = choice(url.searchParams.get('basis') || 'calendar', ['calendar', 'fiscal'] as const, 'year basis')
 const monthDay = basis === 'fiscal' ? s.fiscal_year_start : '01-01'
 const currentYear = Number(fiscalPeriod(asOf, monthDay).start.slice(0, 4))
 const raw = url.searchParams.get('year') ?? String(currentYear)
 if (!/^\d{4}$/.test(raw)) fail('INPUT', 'Choose a four-digit report year.', 400)
 const year = integer(Number(raw), 'Report year', 1004, currentYear)
 const periods = Array.from({ length: 5 }, (_, index) => {
  const y = year - 4 + index, start = `${y}-${monthDay}`, next = `${y + 1}-${monthDay}`
  return { year: y, start, through: y === currentYear ? asOf : addDays(next, -1) }
 })
 const start = periods[0].start, through = periods[4].through
 // No fund/allocation or recognition joins: each signed monetary entry counts
 // once. Unknown/erased identities remain in the reconciliation, without PII.
 const [entries, properties] = await Promise.all([
  all(c, `SELECT l.donor_id,l.received_on,SUM(l.amount_cents) AS cents,COUNT(*) AS entries,
   d.name,d.erased_at,d.address_line1,d.address_line2,d.city,d.region,d.postal_code,d.country
   FROM cf_monetary_contributions l LEFT JOIN cf_donors d ON d.id=l.donor_id
   WHERE l.received_on>=? AND l.received_on<=? GROUP BY l.donor_id,l.received_on`, start, through),
  all(c, `SELECT g.id,g.donor_id,g.received_on,g.description,g.quantity,g.stated_value_cents,
   g.disposed_on,d.name,d.erased_at,d.address_line1,d.address_line2,d.city,d.region,d.postal_code,d.country
   FROM cf_in_kind_current g LEFT JOIN cf_donors d ON d.id=g.donor_id
   WHERE g.received_on>=? AND g.received_on<=? ORDER BY g.received_on,g.id`, start, through),
 ])
 const annual = new Map<string, Annual>()
 const add = (r: Row, monetaryCents: number, noncashStatedCents: number) => {
  const donorId = r.name && !r.erased_at ? String(r.donor_id) : null
  const y = Number(fiscalPeriod(r.received_on, monthDay).start.slice(0, 4)), key = JSON.stringify([donorId, y])
  let row = annual.get(key)
  if (!row) {
   row = { donorId, name: donorId ? r.name : 'Unidentified contributions', address: donorId ? [r.address_line1,r.address_line2,[r.city,r.region,r.postal_code].filter(Boolean).join(' '),r.country].filter(Boolean) : [], year: y, monetaryCents: 0, noncashStatedCents: 0, ledgerEntries: 0 }
   annual.set(key, row)
  }
  row.monetaryCents = sum([row.monetaryCents, monetaryCents]); row.noncashStatedCents = sum([row.noncashStatedCents, noncashStatedCents]); row.ledgerEntries += r.entries ?? 0
 }
 entries.forEach(r => add(r, r.cents, 0)); properties.forEach(r => add(r, 0, r.stated_value_cents))
 const grouped = new Map<string | null, Annual[]>()
 for (const row of annual.values()) grouped.set(row.donorId, [...(grouped.get(row.donorId) ?? []),row])
 const donors = [...grouped.entries()].map(([donorId, rows]) => {
  const identity = rows[0]
  const years = periods.map(period => {
   const row = rows.find(r => r.year === period.year)
   return { year: period.year, monetaryCents: row?.monetaryCents ?? 0, noncashStatedCents: row?.noncashStatedCents ?? 0, ledgerEntries: row?.ledgerEntries ?? 0 }
  })
  return { donorId, name: identity.name, address: identity.address, years,
   monetaryCents: sum(years.map(y => y.monetaryCents)), noncashStatedCents: sum(years.map(y => y.noncashStatedCents)) }
 }).sort((a, b) => a.name.localeCompare(b.name) || String(a.donorId).localeCompare(String(b.donorId)))
 const totals = periods.map((period, index) => ({ ...period,
  monetaryCents: sum(donors.map(d => d.years[index].monetaryCents)),
  noncashStatedCents: sum(donors.map(d => d.years[index].noncashStatedCents)),
  ledgerEntries: sum(donors.map(d => d.years[index].ledgerEntries)),
 }))
 const current = totals[4], workingContributionCents = sum([current.monetaryCents,current.noncashStatedCents])
 const denominator = configuration.denominator?.start === current.start && configuration.denominator?.through === through ? configuration.denominator.cents : null
 const needsContributionTotal = configuration.rule === 'public_support' && denominator === null
 // Compare integer cents exactly; equality to 2% is excluded. All gifts count,
 // including gifts below $1,000 (IRS permits, but does not require, omission).
 const qualifies = (cents: number) => cents >= 500000 && (configuration.rule === 'general' || (denominator !== null && BigInt(cents) * 50n > BigInt(denominator)))
 const contributors = donors.map(d => {
  const current = d.years[4], workingCents = sum([current.monetaryCents,current.noncashStatedCents])
  return { donorId: d.donorId, name: d.name, address: d.address, ...current, workingCents,
   monetaryOnlyQualifies: qualifies(current.monetaryCents) }
 })
 const rows = contributors.filter(d => d.donorId !== null && qualifies(d.workingCents))
 const noncashRows = properties.filter(g => g.received_on >= current.start).map(g => ({
  id: g.id, donorId: g.name && !g.erased_at ? g.donor_id : null, donorName: g.name && !g.erased_at ? g.name : 'Unidentified donor',
  receivedOn: g.received_on, description: g.description, quantity: g.quantity, statedValueCents: g.stated_value_cents, disposedOn: g.disposed_on,
 }))
 return { year, basis, monthDay, start: current.start, through, asOf, timezone: s.timezone, currentYear, configuration, sources: SOURCES,
  methodology: 'Received monetary contributions use signed ledger amounts on their entry dates, including refunds; payments count once across splits. Soft credits and unpaid pledges are excluded. All gift sizes are included. Current donor addresses are shown. Property uses current donor-stated internal values separately; it is not a financial-statement valuation. Anonymous or erased identity amounts remain in totals and require accountant review.',
  scheduleB: { rule: configuration.rule, rows, contributionTotalCents: current.monetaryCents, noncashStatedCents: current.noncashStatedCents,
   workingContributionCents, denominatorCents: denominator, needsContributionTotal, generalMinimumCents: 500000, twoPercentCents: denominator === null ? null : denominator / 50,
   unidentified: contributors.find(d => d.donorId === null) ?? null,
   belowThresholdMonetaryCents: sum(contributors.filter(d => d.donorId !== null && !rows.includes(d)).map(d => d.monetaryCents)),
   note: 'Working contributor list: general rule is at least $5,000; special rule is at least $5,000 AND strictly more than 2% of total contributions. The special rule requires a qualifying 501(c)(3) 33⅓% public-support test, including the IRS first-five-years exception; the 10% test alone does not qualify. The special-rule denominator is the accountant-provided Form 990 Part VIII line 1h total for this exact period. Contributor amounts use monetary ledger plus donor-stated property values as a working estimate. Reconcile property to return accounting values; this is not a filed Schedule B.' },
  scheduleA: { periods, donors, totals, monetaryCents: sum(totals.map(y => y.monetaryCents)), noncashStatedCents: sum(totals.map(y => y.noncashStatedCents)),
   note: 'Current and four preceding years of giving for accountant review. These are inputs to the public-support test, not a computed support percentage. The accountant must apply return accounting, related-contributor grouping, governmental/public-charity exceptions, unusual grants and other support adjustments.' },
  scheduleM: { rows: noncashRows, giftCount: noncashRows.length, statedValueCents: sum(noncashRows.map(g => g.statedValueCents)),
   valuationBasis: 'Donor-stated internal value; accountant must determine the financial-statement amount, valuation method and property categories for Schedule M. Includes property received in the selected period even when already disposed. Does not include donated services or use of facilities.' },
 }
}
