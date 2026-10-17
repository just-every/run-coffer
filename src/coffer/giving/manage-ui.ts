import type { Context, Row } from '../db'
import { area, box, chip, e, empty, field, hidden, money } from '../ui/common'
import { campaigns, subscriptions } from './campaigns'
import { available, managed, type GivingEnv } from './stripe'

function connection(c: Context) {
 const env = c.env as GivingEnv
 if (managed(env)) return box('Stripe', '<p>Stripe is not available yet on RER Managed. Campaign pages stay visible; donors cannot check out yet.</p>')
 if (available(env)) return `<p class="notice">${chip(/_live_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'Stripe live mode' : 'Stripe test mode', 'ok')} Campaign pages take gifts. <a href="/app/giving/setup">Stripe connection and webhook</a></p>`
 // The demo simulates external writes: its online gifts were recorded as checkout records them, but no Stripe account is behind it.
 if (env.RER_DEMO === '1') return box('Stripe in this demo', `<p>The demo pantry’s online gifts, monthly plans and recovered card were recorded the way Coffer’s Stripe checkout records them. No Stripe account is connected to the demo, so its campaign page shows the story and total but cannot take a new gift.</p><p><a href="/app/giving/setup">How a real Coffer connects Stripe</a></p>`)
 return box('Connect Stripe to take gifts', `<p>Donors give on your campaign pages through Stripe, the payment company that handles their cards. Until Stripe is connected, a campaign page shows the story and total but cannot take a gift.</p><p><a class="button" href="/app/giving/setup">Connect Stripe</a></p>`)
}

export async function givingManagePage(c: Context) {
 const list = await campaigns(c)
 return connection(c) + box('Campaigns', list.length ? `<ul class="list">${list.map(row => `<li><a href="/give/${e(row.slug)}">${e(row.name)}</a><br><strong>${money(row.raised_cents)}</strong> of ${money(row.goal_cents)} · <a href="/app/gifts?campaign=${encodeURIComponent(row.id)}">${row.gift_count} campaign ${row.gift_count === 1 ? 'gift' : 'gifts'}</a> · ${row.recurring_donors} recurring ${row.recurring_donors === 1 ? 'donor' : 'donors'}<br><span class="muted">Gifts go to the ${e(row.fund)} fund. The total counts gifts made through this campaign, not every gift to the fund.</span></li>`).join('')}</ul>` : empty('Publish your first campaign to start accepting gifts.')) + (['owner', 'admin'].includes(c.actor.role) ? box('Publish a campaign', `<form method="post" action="/app/giving/campaigns">${field('Campaign name', 'name', 'text', '', 'required maxlength="120"')}${field('Page address', 'slug', 'text', '', 'required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="spring-reading"')}${area('Description', 'description', '', 'required maxlength="2000"')}<div class="fields">${field('Goal (USD)', 'goal', 'text', '', 'required inputmode="decimal"')}${field('Fund', 'fund', 'text', 'Unrestricted', 'required maxlength="100"')}</div><button>Publish campaign</button></form>`) : '')
}
export const monthlyLabel = (s: Row) => `Monthly ${money(s.amount_cents)} · ${s.status === 'active' ? 'Active' : s.status === 'past_due' ? 'Past due' : s.status === 'canceled' ? 'Cancelled' : s.status}`
export async function donorGiving(c: { db: D1Database }, donorId: string) {
 const plans = await subscriptions(c, donorId)
 if (!plans.length) return ''
 return box('Monthly giving', `<ul class="list">${plans.map(s => `<li><strong>${e(monthlyLabel(s))}</strong><br>${e(s.campaign)}${s.cancel_at_period_end ? '<br>Ends at the close of the billing period.' : ''}${s.recovered ? `<br>${chip('Failed card · Retried successfully', 'ok')}` : s.failed_attempts ? `<br>${chip('Failed card · Stripe retries scheduled', 'warn')}${s.next_attempt_at ? `<br>Next attempt: ${e(new Date(s.next_attempt_at * 1000).toISOString().slice(0, 16).replace('T', ' '))} UTC` : ''}` : ''}</li>`).join('')}</ul>`)
}
