// Gifts: the working screen the owner picked (design desk, 17 Oct 2026). A
// progress strip, tabbed gift ledger and the selected donor's panel, all read
// from the recorded gifts, plans, letters and agent runs. The strip's figures are
// links to the ledger rows they count, so the two always agree.
import { manager } from '../auth'
import type { Context, Row } from '../db'
import { GIFT_PAGE, GIFT_TABS, giftById, giftList, giftProgress, overnight, type GiftScope, type GiftTab } from '../gift-list'
import { donorPanel } from './gift-panel'
import { giftLetter } from './letters'
import { chip, e, empty, hidden, money, paidBy, shortDate } from './common'
import { icon } from './icons'
import { pager } from './ledger'

/** [label, short label at phone width]: four tabs fit one line at 390 without scrolling. */
const TAB_LABELS: Record<GiftTab, [string, string]> = { all: ['All gifts', 'All'], attention: ['Needs attention', 'Attention'], letters: ['Letters due', 'Letters'], monthly: ['Monthly giving', 'Monthly'] }
/** Checkout records a one-time gift on its campaign and a monthly gift on its plan
 * (giving/recording.ts). A Stripe charge moved in from an export carries neither, so
 * Coffer cannot know its frequency and says what it is. */
const KIND = (g: Row) => g.plan_id ? 'Monthly' : g.pledge_id ? 'Pledge payment' : g.source === 'stripe' && !g.campaign ? 'Stripe charge' : 'One-time'
export const place = (d: Row) => [d.city, d.region].filter(Boolean).join(', ')

/** A plan's card retries belong to its newest gift; earlier gifts on the plan were simply recorded. */
function giftStatus(g: Row, planHead: boolean) {
 if (g.reversed_by) return chip('Reversed')
 if (planHead && g.failed_attempts > 0) return g.recovered ? chip('Card failed · retried', 'retry') : chip('Card failed · retrying', 'warn')
 if (g.goods === 'unknown') return `<span title="Goods or services not answered: answer it on the donor’s page">${chip('Goods unanswered', 'warn')}</span>`
 return chip('Recorded', 'ok')
}

function readScope(url: URL): GiftScope {
 const campaign = url.searchParams.get('campaign'), fund = url.searchParams.get('fund'), year = url.searchParams.get('year') ?? ''
 if (campaign) return { campaign }
 if (fund && /^\d{4}$/.test(year)) return { fund, year }
 return null
}

export async function giftsPage(c: Context, url: URL) {
 const tab = (GIFT_TABS as readonly string[]).includes(url.searchParams.get('tab') ?? '') ? url.searchParams.get('tab') as GiftTab : 'all'
 const pageNo = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0), scope = readScope(url)
 const list = await giftList(c, tab, pageNo, scope), s = list.settings, boss = manager(c.actor), year = list.today.slice(0, 4)
 const asked = url.searchParams.get('gift')
 const selected = (asked ? list.rows.find(g => g.id === asked) ?? await giftById(c, asked) : null)
  ?? list.rows.find(g => g.failed_attempts > 0) ?? list.rows[0] ?? null
 const [progress, night, panel] = await Promise.all([giftProgress(c, year), overnight(c), selected ? donorPanel(c, selected.donor_id, s.timezone) : ''])
 const scopeParams: Record<string, string> = !scope ? {} : 'campaign' in scope ? { campaign: scope.campaign } : { fund: scope.fund, year: scope.year }
 const link = (values: Record<string, string | number>, keepScope = true) => `/app/gifts?${new URLSearchParams(Object.entries({ tab, ...(keepScope ? scopeParams : {}), ...values }).map(([k, v]) => [k, String(v)]).filter(([, v]) => v !== 'all' && v !== '0'))}`
 const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

 const { campaign, fund, totals, payouts } = progress
 const ledgerOf = (values: Record<string, string>) => `/app/gifts?${new URLSearchParams(values)}`
 const payoutLine = payouts.total ? `<p class="cf-metric cf-full">Payouts posted <b class="cf-good">${payouts.posted} of ${payouts.total}</b></p>` : ''
 const strip = campaign
  ? `<section class="cf-strip" aria-label="Campaign progress"><h2>${e(campaign.name)}</h2><meter min="0" max="${campaign.goal_cents}" value="${Math.min(campaign.raised_cents, campaign.goal_cents)}">${e(money(campaign.raised_cents))}</meter>
   <p class="cf-raised"><strong>${money(campaign.raised_cents)}</strong> of ${money(campaign.goal_cents)}</p>
   <p class="cf-metric cf-full"><a href="${ledgerOf({ campaign: campaign.id })}"><b>${campaign.gift_count}</b> campaign ${campaign.gift_count === 1 ? 'gift' : 'gifts'}</a></p>
   <p class="cf-metric cf-full"><b>${campaign.recurring_donors}</b> recurring ${campaign.recurring_donors === 1 ? 'donor' : 'donors'}</p>
   ${fund ? `<p class="cf-metric cf-full"><a href="${ledgerOf({ fund: fund.fund, year })}">${e(fund.fund)} fund in ${e(year)} <b>${money(fund.amount_cents)}</b></a></p>` : ''}${payoutLine}</section>`
  : `<section class="cf-strip" aria-label="Giving this year"><h2>Given in ${e(year)}</h2><p class="cf-raised"><strong>${money(totals.year_cents)}</strong></p><p class="cf-metric"><b>${totals.year_gifts}</b> ${totals.year_gifts === 1 ? 'gift' : 'gifts'}</p><p class="cf-metric cf-full"><b>${totals.plans}</b> monthly ${totals.plans === 1 ? 'plan' : 'plans'}</p>${boss ? '<p class="cf-metric cf-full"><a href="/app/giving">Publish a campaign</a></p>' : ''}${payoutLine}</section>`

 const counts: Partial<Record<GiftTab, number>> = { attention: list.counts.attention, letters: list.counts.letters }
 const tabs = `<nav class="cf-tabs" aria-label="Gift views">${GIFT_TABS.map(t => `<a href="${link({ tab: t })}"${t === tab ? ' aria-current="page"' : ''}><span class="cf-full">${TAB_LABELS[t][0]}</span><span class="cf-short">${TAB_LABELS[t][1]}</span>${counts[t] ? ` <span class="cf-count">${counts[t]}</span>` : ''}</a>`).join('')}</nav>`
 const pagerLine = pager(list.total, pageNo, GIFT_PAGE, n => link({ page: n }), true)
 const scopeName = !scope ? '' : 'campaign' in scope ? (campaign?.id === scope.campaign ? `${campaign.name} campaign` : 'one campaign') : `${scope.fund} fund, ${scope.year}`
 const scopeBar = scope ? `<p class="cf-scope">${icon('chart')}<span>Showing gifts counted in <strong>${e(scopeName)}</strong></span><a href="${link({ tab }, false)}">Show all gifts</a></p>` : ''

 const prepare = tab === 'letters' && boss && !!s.reviewed_at && list.rows.length > 0
 const heads = new Set<string>()
 const rows = list.rows.map(g => {
  const planHead = !!g.plan_id && !heads.has(g.plan_id); if (g.plan_id) heads.add(g.plan_id)
  const chosen = g.id === selected?.id, where = place(g)
  return `<tr${chosen ? ' class="is-selected"' : ''}>${prepare ? `<td class="cf-pick">${g.goods === 'unknown' ? '' : `<input type="checkbox" name="giftIds" value="${e(g.id)}" form="prepare-letters" aria-label="Select the ${e(money(g.amount_cents))} gift from ${e(g.donor_name)}">`}</td>` : ''}<td class="cf-date">${shortDate(g.received_on)}</td><td class="cf-who-cell"><a href="${link({ page: pageNo, gift: g.id })}#donor"${chosen ? ' aria-current="true"' : ''}><strong>${e(g.donor_name)}</strong></a><small${where ? '' : ' class="cf-none"'}>${where ? e(where) : 'No address on file'}</small></td><td class="cf-fund" data-label="Fund" title="${e(g.fund)}">${g.parts ? `Split · ${g.parts} parts` : e(g.fund)}</td><td class="cf-amount"><strong>${money(g.amount_cents)}</strong><small>${KIND(g)}</small></td><td class="cf-method" data-label="Paid by">${e(paidBy(g))}</td><td class="cf-status">${giftStatus(g, planHead)}</td><td class="cf-letter" data-label="Letter">${giftLetter(g, s.threshold_cents, null)}</td><td class="cf-open"><a href="/app/donors/${e(g.donor_id)}" aria-label="Open ${e(g.donor_name)}’s record">${icon('right')}</a></td></tr>`
 }).join('')
 const emptyText = scope ? 'No gifts in this view.' : tab === 'attention' ? 'Nothing needs a person right now.' : tab === 'letters' ? 'No gifts are waiting for a letter.' : tab === 'monthly' ? 'No monthly gifts yet. Donors start monthly giving on a campaign page.' : 'No gifts recorded yet. Record one on a donor’s page, or move in a year of gifts.'
 const table = list.rows.length ? `<table class="cf-ledger-table${prepare ? ' has-pick' : ''}"><thead><tr>${prepare ? '<th><span class="sr">Select</span></th>' : ''}<th>Date</th><th>Donor</th><th>Fund</th><th>Amount</th><th>Paid by</th><th>Status</th><th>Letter</th><th><span class="sr">Open</span></th></tr></thead><tbody>${rows}</tbody></table>` : empty(emptyText)
 const prepareForm = prepare ? `<form method="post" action="/app/actions" id="prepare-letters" class="cf-prepare">${hidden('command', 'ack.prepare')}<p class="muted">Tick gifts, then prepare their letters from your saved wording. Nothing goes out until a person approves the batch. A gift still needing its goods or services answer is answered on the donor’s page first.</p><button>Prepare letters for selected</button></form>` : ''

 const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: s.timezone }).format(new Date(c.now))
 const lapse = night.lapse, why = lapse ? (lapse.kind === 'monthly' ? 'monthly plan stopped' : lapse.kind === 'lybunt' ? 'gave last year, not this year' : `last gave in ${lapse.referenceYear}`) : ''
 const due = plural(Number(list.counts.letters_all), 'letter')
 const footer = `<div class="cf-overnight" aria-label="Overnight work">${night.run ? `<p>${icon('check', 'cf-dot ok')}<span>Checked ${plural(Number(night.run.checkedCharges), 'Stripe charge')} and ${plural(Number(night.run.checkedPayouts), 'payout')} ${e(shortDate(night.run.at))}. ${due} due.</span></p>` : `<p>${icon('file', 'cf-dot')}<span>${due} due.${boss ? ' <a href="/app/agent/reconcile">Reconcile gifts</a>' : ''}</span></p>`}${lapse ? `<p class="cf-call"><a href="/app/lapses">${icon('phone', 'cf-dot warn')}<span>${e(lapse.name)}, ${e(why)}: call suggested</span>${icon('right', 'cf-chev')}</a></p>` : ''}<p class="cf-updated">Last updated ${e(time)}</p></div>`

 return `${strip}<div class="cf-gifts${asked && selected ? ' is-picked' : ''}"><div class="cf-gifts-main"><section class="cf-ledger" aria-label="${TAB_LABELS[tab][0]}">${tabs}${pagerLine}${scopeBar}<div class="cf-ledger-body">${table}</div>${prepareForm}</section>${footer}</div>${panel}</div>`
}
