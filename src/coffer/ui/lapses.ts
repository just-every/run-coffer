import { person } from '../auth'
import { addDays, all, type Context } from '../db'
import { lapses, type LapseKind } from '../lapses'
import { box, chip, e, empty, field, form, longDay, money, select } from './common'

const LABELS: Record<LapseKind, string> = { lybunt: 'Last year, not this year (LYBUNT)', sybunt: 'Some earlier year, not last year or this year (SYBUNT)', monthly: 'Stopped monthly plans' }

export async function lapsesPage(c: Context, url: URL): Promise<string> {
 const [report, owners] = await Promise.all([
  lapses(c),
  all<{ id: string; name: string }>(c, "SELECT id,display_name AS name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY lower(display_name),id"),
 ])
 const ownerOptions: [string, string][] = owners.map(owner => [owner.id, owner.name])
 const requestedOwner = url.searchParams.get('ownerId')
 const ownerId = ownerOptions.some(([id]) => id === requestedOwner) ? requestedOwner! : c.actor.id
 const dueOn = addDays(report.asOf, 7)
 return `<p>As of <strong>${longDay(report.asOf)}</strong> · ${e(report.timezone)}. Annual lapses are provisional until ${report.year} ends.</p>
 <div class="stats"><a class="stat" href="#lapse-donors"><strong>${report.totals.donorCount}</strong><span>donors needing review</span></a><a class="stat" href="#lapse-donors"><strong>${money(report.totals.amountCents)}</strong><span>annual reference amount at risk</span></a></div>
 ${box('How these donors are identified', `<p>${e(report.policy)}</p><p>Annual giving uses signed contribution ledger amounts, including dated refunds and reversals. Last gift and monthly paid history use gift balances, excluding fully reversed or refunded gifts. Gifts on another plan or one-off gifts cannot reset a monthly plan’s clock.</p>${report.suppressedAnnualCount ? `<p>${report.suppressedAnnualCount} annual lapse rows are excluded because those donors already have stopped monthly plans listed below.</p>` : ''}`)}
 <div id="lapse-donors">${report.groups.map(group => box(LABELS[group.kind], `<p><a href="#${group.kind}-rows">${group.donorCount} donors · ${group.count} ${group.kind === 'monthly' ? 'plans' : 'rows'} · ${money(group.amountCents)} annual reference amount</a></p>
  ${group.rows.length ? `<ul class="list" id="${group.kind}-rows">${group.rows.map(row => `<li><h3><a href="/app/donors/${encodeURIComponent(row.donorId)}">${e(row.name)}</a> ${chip(money(row.amountCents), 'warn')}</h3><p>${e(row.reason)}</p>
   <p>${row.kind === 'monthly' ? `${money(row.monthlyCents!)} per month × 12 installments` : `${row.referenceYear} net received`} · last gift with a positive balance: ${row.lastGift ? longDay(row.lastGift) : 'Unknown'}${row.sourceId ? ` · plan <code>${e(row.sourceId)}</code>` : ''}.</p>
   ${person(c.actor) && ownerOptions.length ? `<details class="edit"><summary>Create a follow-up task</summary>${form('task.generate', `<div class="fields">${select('Task owner', 'ownerId', ownerOptions, ownerId, 'required')}${field('Due on', 'dueOn', 'date', dueOn, 'required')}</div>`, 'Create follow-up task', { sourceKey: row.sourceKey, donorId: row.donorId })}</details>` : ''}</li>`).join('')}</ul>` : empty('No donors match this lapse policy.')}`, group.kind)).join('')}</div>
 <p><a href="/app/retention">Open the retention report</a> · <a href="/app/calls">View follow-up tasks</a></p>`
}
