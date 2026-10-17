// Gifts: the working screen the owner picked (design desk, 17 Oct 2026). A
// progress strip, tabbed gift ledger and the selected donor's panel, all read
// from the recorded gifts, plans, letters and agent runs.
import { manager } from '../auth'
import type { Context, Row } from '../db'
import { GIFT_TABS, giftById, giftList, givingSummary, overnight, type GiftTab } from '../gift-list'
import { donorPanel } from './gift-panel'
import { giftLetter } from './letters'
import { chip, e, empty, hidden, money, shortDate } from './common'
import { icon } from './icons'

const TAB_LABELS: Record<GiftTab, string> = { all: 'All gifts', attention: 'Needs attention', letters: 'Letters due', monthly: 'Monthly giving' }
const METHOD = (g: Row) => `${g.method.charAt(0).toUpperCase()}${g.method.slice(1)}${g.method === 'check' && g.reference ? ` · ${g.reference}` : ''}`
const KIND = (g: Row) => g.plan_id ? 'Monthly' : g.pledge_id ? 'Pledge payment' : g.source === 'stripe' ? 'Stripe charge' : 'One-time'
export const place = (d: Row) => [d.city, d.region].filter(Boolean).join(', ')

/** A plan's card retries belong to its newest gift; earlier gifts on the plan were simply recorded. */
function giftStatus(g: Row, planHead: boolean) {
 if (g.reversed_by) return chip('Reversed')
 if (planHead && g.failed_attempts > 0) return g.recovered ? chip('Failed card · Retried successfully', 'retry') : chip('Failed card · Stripe retries scheduled', 'warn')
 if (g.goods === 'unknown') return chip('Goods/services not answered', 'warn')
 return chip('Recorded', 'ok')
}

export async function giftsPage(c: Context, url: URL) {
 const tab = (GIFT_TABS as readonly string[]).includes(url.searchParams.get('tab') ?? '') ? url.searchParams.get('tab') as GiftTab : 'all'
 const pageNo = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0)
 const list = await giftList(c, tab, pageNo), s = list.settings, boss = manager(c.actor)
 const asked = url.searchParams.get('gift')
 const selected = (asked ? list.rows.find(g => g.id === asked) ?? await giftById(c, asked) : null)
  ?? list.rows.find(g => g.failed_attempts > 0) ?? list.rows[0] ?? null
 const [summary, night, panel] = await Promise.all([givingSummary(c, list.today.slice(0, 4)), overnight(c), selected ? donorPanel(c, selected.donor_id, s.timezone) : ''])
 const link = (values: Record<string, string | number>) => `/app/gifts?${new URLSearchParams(Object.entries({ tab, ...values }).map(([k, v]) => [k, String(v)]).filter(([, v]) => v !== 'all' && v !== '0'))}`

 const { campaign, totals, payouts } = summary
 const strip = `<section class="cf-strip" aria-label="Giving progress">${campaign
  ? `<h2>${e(campaign.name)}</h2><meter min="0" max="${campaign.goal_cents}" value="${Math.min(campaign.raised_cents, campaign.goal_cents)}">${e(money(campaign.raised_cents))}</meter><p class="cf-raised"><strong>${money(campaign.raised_cents)}</strong> of ${money(campaign.goal_cents)}</p><p class="cf-metric"><b>${campaign.gift_count}</b> ${campaign.gift_count === 1 ? 'gift' : 'gifts'}</p><p class="cf-metric"><b>${campaign.recurring_donors}</b> recurring ${campaign.recurring_donors === 1 ? 'donor' : 'donors'}</p>`
  : `<h2>Given in ${e(list.today.slice(0, 4))}</h2><p class="cf-raised"><strong>${money(totals.year_cents)}</strong></p><p class="cf-metric"><b>${totals.year_gifts}</b> ${totals.year_gifts === 1 ? 'gift' : 'gifts'}</p><p class="cf-metric"><b>${totals.plans}</b> monthly ${totals.plans === 1 ? 'plan' : 'plans'}</p>${boss ? '<p class="cf-metric"><a href="/app/giving">Publish a campaign</a></p>' : ''}`}${payouts.total ? `<p class="cf-metric">Payouts posted <b class="cf-good">${payouts.posted} of ${payouts.total}</b></p>` : ''}</section>`

 const counts: Partial<Record<GiftTab, number>> = { attention: list.counts.attention, letters: list.counts.letters }
 const tabs = `<nav class="cf-tabs" aria-label="Gift views">${GIFT_TABS.map(t => `<a href="${link({ tab: t })}"${t === tab ? ' aria-current="page"' : ''}>${TAB_LABELS[t]}${counts[t] ? ` <span class="cf-count">${counts[t]}</span>` : ''}</a>`).join('')}</nav>`

 const prepare = tab === 'letters' && boss && !!s.reviewed_at && list.rows.length > 0
 const heads = new Set<string>()
 const rows = list.rows.map(g => {
  const planHead = !!g.plan_id && !heads.has(g.plan_id); if (g.plan_id) heads.add(g.plan_id)
  const chosen = g.id === selected?.id
  return `<tr${chosen ? ' class="is-selected"' : ''}>${prepare ? `<td class="cf-pick">${g.goods === 'unknown' ? '' : `<input type="checkbox" name="giftIds" value="${e(g.id)}" form="prepare-letters" aria-label="Select the ${e(money(g.amount_cents))} gift from ${e(g.donor_name)}">`}</td>` : ''}<td class="cf-date">${shortDate(g.received_on)}</td><td class="cf-who-cell"><a href="${link({ page: pageNo, gift: g.id })}#donor"${chosen ? ' aria-current="true"' : ''}><strong>${e(g.donor_name)}</strong></a><small>${e(place(g))}</small></td><td class="cf-fund" data-label="Fund">${e(g.fund)}</td><td class="cf-amount"><strong>${money(g.amount_cents)}</strong><small>${KIND(g)}</small></td><td class="cf-method" data-label="Paid by">${e(METHOD(g))}</td><td class="cf-status">${giftStatus(g, planHead)}</td><td class="cf-letter" data-label="Letter">${giftLetter(g, s.threshold_cents, null)}</td><td class="cf-open"><a href="/app/donors/${e(g.donor_id)}" aria-label="Open ${e(g.donor_name)}’s record">${icon('right')}</a></td></tr>`
 }).join('')
 const emptyText = tab === 'attention' ? 'Nothing needs a person right now.' : tab === 'letters' ? 'No gifts are waiting for a letter.' : tab === 'monthly' ? 'No monthly gifts yet. Donors start monthly giving on a campaign page.' : 'No gifts recorded yet. Record one on a donor’s page, or move in a year of gifts.'
 const table = list.rows.length ? `<table class="cf-ledger-table${prepare ? ' has-pick' : ''}"><thead><tr>${prepare ? '<th><span class="sr">Select</span></th>' : ''}<th>Date</th><th>Donor</th><th>Fund</th><th>Amount</th><th>Paid by</th><th>Status</th><th>Letter</th><th><span class="sr">Open</span></th></tr></thead><tbody>${rows}</tbody></table>` : empty(emptyText)
 const paging = list.more || pageNo > 0 ? `<p class="paging">${pageNo > 0 ? `<a href="${link({ page: pageNo - 1 })}">Previous</a>` : ''}${list.more ? `<a href="${link({ page: pageNo + 1 })}">Next</a>` : ''}</p>` : ''
 const prepareForm = prepare ? `<form method="post" action="/app/actions" id="prepare-letters" class="cf-prepare">${hidden('command', 'ack.prepare')}<p class="muted">Tick gifts, then prepare their letters from your saved wording. Nothing goes out until a person approves the batch. A gift still needing its goods or services answer is answered on the donor’s page first.</p><button>Prepare letters for selected</button></form>` : ''

 const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: s.timezone }).format(new Date(c.now))
 const lapse = night.lapse, why = lapse ? (lapse.kind === 'monthly' ? 'monthly plan stopped' : lapse.kind === 'lybunt' ? 'gave last year, not this year' : `last gave in ${lapse.referenceYear}`) : ''
 const footer = `<div class="cf-overnight">${night.run ? `<p>${icon('check', 'cf-dot ok')}Checked ${e(night.run.checkedCharges)} Stripe charges and ${e(night.run.checkedPayouts)} payouts ${e(shortDate(night.run.at))}. ${list.counts.letters} ${list.counts.letters === 1 ? 'letter' : 'letters'} due.</p>` : `<p>${icon('file', 'cf-dot')}${list.counts.letters} ${list.counts.letters === 1 ? 'letter' : 'letters'} due.${boss ? ' <a href="/app/agent/reconcile">Reconcile gifts</a>' : ''}</p>`}${lapse ? `<p class="cf-call"><a href="/app/lapses">${icon('phone', 'cf-dot warn')}${e(lapse.name)}, ${e(why)}: call suggested ${icon('right', 'cf-chev')}</a></p>` : ''}<p class="cf-updated">Last updated ${e(time)}</p></div>`

 return `${strip}<div class="cf-gifts${asked && selected ? ' is-picked' : ''}"><div class="cf-gifts-main"><section class="cf-ledger" aria-label="${TAB_LABELS[tab]}">${tabs}<div class="cf-ledger-body">${table}</div>${paging}${prepareForm}</section>${footer}</div>${panel}</div>`
}
