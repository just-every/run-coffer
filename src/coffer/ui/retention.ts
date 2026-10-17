import type { Context } from '../db'
import { retention, type RetentionKind, type RetentionRow } from '../retention'
import { box, e, empty, field, money, when } from './common'

const LABELS: Record<RetentionKind, string> = { retained: 'Retained', new: 'New', lapsed: 'Lapsed', recaptured: 'Recaptured' }
const EXPLANATIONS: Record<RetentionKind, string> = {
 retained: 'Positive net giving in both periods.',
 new: 'Positive net giving in the selected year, with no earlier positive net calendar year recorded.',
 lapsed: 'Positive net giving in the prior year; no positive net giving in the selected period.',
 recaptured: 'Positive net giving in the selected year and an earlier year, with no positive net giving in the prior year.',
}
const link = (target: string, value: string | number) => `<a href="#${e(target)}">${e(value)}</a>`

function donorTable(rows: RetentionRow[], priorYear: number, year: number): string {
 if (!rows.length) return empty('No donors in this group.')
 return `<table class="stack"><thead><tr><th scope="col">Donor</th><th scope="col">${priorYear} net received</th><th scope="col">${year} net received</th><th scope="col">Last gift with a positive balance</th></tr></thead><tbody>${rows.map(row => {
  const href = `/app/donors/${encodeURIComponent(row.donorId)}`
  return `<tr><td class="lead"><a href="${href}">${e(row.name)}</a></td><td data-label="${priorYear} net received"><a href="${href}">${money(row.priorCents)}</a></td><td data-label="${year} net received"><a href="${href}">${money(row.currentCents)}</a></td><td data-label="Last gift">${row.lastGift ? when(row.lastGift) : 'None with a positive balance'}</td></tr>`
 }).join('')}</tbody></table>`
}

export async function retentionPage(c: Context, url: URL): Promise<string> {
 const report = await retention(c, url.searchParams.get('year') ?? undefined)
 const { year, priorYear, groups, totals } = report
 const cohortRows = Object.values(groups).flatMap(group => group.rows)
 const summary = `<table class="stack"><thead><tr><th scope="col">Donor group</th><th scope="col">Donors</th><th scope="col">${priorYear} net received</th><th scope="col">${year} net received</th></tr></thead><tbody>${Object.values(groups).map(group => `<tr><td class="lead">${link(group.kind, LABELS[group.kind])}</td><td data-label="Donors">${link(group.kind, group.count)}</td><td data-label="${priorYear} net received">${link(group.kind, money(group.priorCents))}</td><td data-label="${year} net received">${link(group.kind, money(group.currentCents))}</td></tr>`).join('')}
 <tr><td class="lead">Adjustment-only donors</td><td data-label="Donors">${link('adjustments', report.adjustments.count)}</td><td data-label="${priorYear} net received">${link('adjustments', money(report.adjustments.priorCents))}</td><td data-label="${year} net received">${link('adjustments', money(report.adjustments.currentCents))}</td></tr>
 <tr><th scope="row">All live donors</th><td data-label="Donors">${link('all-donors', totals.count)}</td><td data-label="${priorYear} net received">${link('all-donors', money(totals.priorCents))}</td><td data-label="${year} net received">${link('all-donors', money(totals.currentCents))}</td></tr></tbody></table>`
 return `<form method="get" action="${e(url.pathname)}"><div class="fields">${field('Calendar year', 'year', 'number', year, `required min="1000" max="${report.asOf.slice(0, 4)}"`)}</div><button>View year</button></form>
 <p><strong>${e(report.prior.label)}</strong> compared with <strong>${e(report.current.label)}</strong> · ${e(report.timezone)}.</p>
 <p class="muted">The prior year is complete. ${year === Number(report.asOf.slice(0, 4)) ? 'The selected year is still in progress, so these are provisional lapses until year end.' : 'The selected year is also complete.'} Each donor belongs to at most one group. Giving means positive net received during that period.</p>
 <div class="stats"><a class="stat" href="#prior-donors"><strong>${totals.priorDonors}</strong><span>donors giving in ${priorYear}</span></a><a class="stat" href="#current-donors"><strong>${totals.currentDonors}</strong><span>donors giving in ${year}</span></a><a class="stat" href="#retained"><strong>${totals.retentionRate === null ? '—' : `${(totals.retentionRate * 100).toFixed(1)}%`}</strong><span>retained from ${priorYear}</span></a></div>
 ${box('Giving by donor group', summary)}
 <p class="muted">Net received uses contribution ledger dates, including reversals, refunds and recoveries. Processor fees and soft credits are excluded. A later refund appears in its own calendar year. Last gift uses the latest gift that still has a positive balance, through the selected period.</p>
 ${Object.values(groups).map(group => box(LABELS[group.kind], `<p>${e(EXPLANATIONS[group.kind])}</p>${donorTable(group.rows, priorYear, year)}`, group.kind)).join('')}
 ${box('Adjustment-only donors', `<p>Neither period has positive net giving. These rows can include refunds of older gifts or gifts fully offset by reversals. They reconcile received amounts and are excluded from donor retention counts.</p>${donorTable(report.adjustments.rows, priorYear, year)}`, 'adjustments')}
 <details id="prior-donors" class="card" open><summary>Donors giving in ${priorYear}</summary>${donorTable(cohortRows.filter(row => row.priorCents > 0), priorYear, year)}</details>
 <details id="current-donors" class="card" open><summary>Donors giving in ${year}</summary>${donorTable(cohortRows.filter(row => row.currentCents > 0), priorYear, year)}</details>
 <details id="all-donors" class="card" open><summary>All live donor rows behind the totals</summary>${donorTable([...cohortRows, ...report.adjustments.rows], priorYear, year)}</details>
 ${box('Ledger reconciliation', `<p>Live donor net received: ${link('all-donors', money(totals.priorCents))} in ${priorYear}; ${link('all-donors', money(totals.currentCents))} in ${year}.</p><p>Excluded erased or merged alias identities: ${money(report.excluded.priorCents)} in ${priorYear}; ${money(report.excluded.currentCents)} in ${year}. These identities are excluded from donor drilldowns and counts.</p><p>Complete contribution ledger: ${money(report.ledgerTotals.priorCents)} in ${priorYear}; ${money(report.ledgerTotals.currentCents)} in ${year}.</p>`)}
 <p><a href="/app/lapses">Review donors who may need a follow-up</a></p>`
}
