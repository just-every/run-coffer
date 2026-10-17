import type { givingSummary } from '../giving-summary'
import { box, e, money, when } from './common'

export function givingSummaryPanel(s: Awaited<ReturnType<typeof givingSummary>>) {
 const gift = (g: typeof s.firstGift) => g ? `${money(g.amountCents)} · ${when(g.receivedOn)}` : 'No gift yet'
 const metrics = [
  [money(s.lifetimeCents), 'Lifetime giving'],
  [String(s.giftCount), 'Gifts with a remaining balance'],
  [String(s.consecutiveGivingYears), 'Consecutive fiscal years of giving'],
  [money(s.openPledgeCents), 'Open pledge balance'],
  [money(s.softCreditCents), 'Soft credits · separate recognition'],
  [money(s.fiscalYear.currentCents), `Fiscal year from ${when(s.fiscalYear.start)}`],
  [money(s.fiscalYear.previousCents), `Previous fiscal year from ${when(s.fiscalYear.previousStart)}`],
 ]
 return box('Giving summary', `<div class="stats">${metrics.map(([value, label]) => `<div class="stat"><strong>${e(value)}</strong><span>${e(label)}</span></div>`).join('')}</div>
 <dl class="facts"><dt>First gift</dt><dd>${gift(s.firstGift)}</dd><dt>Largest gift</dt><dd>${gift(s.largestGift)}</dd><dt>Last gift</dt><dd>${gift(s.lastGift)}</dd><dt>Recurring giving</dt><dd>${s.recurring.length ? s.recurring.map(p => `${money(p.amountCents)} monthly · ${e(p.status)}${p.cancelAtPeriodEnd ? ' (cancels at period end)' : ''}`).join('<br>') : 'No recurring plan'}</dd></dl>
 <p class="muted">Gift counts and first, largest and last gifts exclude fully reversed gifts; amounts show the remaining contribution. Fiscal totals include corrections on their recorded dates. Consecutive years include last year's streak while this year's gift is still to come. Soft credits never increase giving totals.</p>`)
}
