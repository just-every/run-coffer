import type { Context, Row } from '../db'
import { area, box, chip, e, empty, field, hidden, money } from '../ui/common'
import { campaigns, subscriptions } from './campaigns'

export async function givingManagePage(c: Context) {
 const list = await campaigns(c)
 return box('Campaigns', list.length ? `<ul class="list">${list.map(row => `<li><a href="/give/${e(row.slug)}">${e(row.name)}</a><br><strong>${money(row.raised_cents)}</strong> of ${money(row.goal_cents)} · ${row.gift_count} gifts · ${row.recurring_donors} recurring donors<br>Fund: ${e(row.fund)}</li>`).join('')}</ul>` : empty('Publish your first campaign to start accepting gifts.')) + (['owner', 'admin'].includes(c.actor.role) ? box('Publish a campaign', `<form method="post" action="/app/giving/campaigns">${field('Campaign name', 'name', 'text', '', 'required maxlength="120"')}${field('Page address', 'slug', 'text', '', 'required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="spring-reading"')}${area('Description', 'description', '', 'required maxlength="2000"')}<div class="fields">${field('Goal (USD)', 'goal', 'text', '', 'required inputmode="decimal"')}${field('Fund', 'fund', 'text', 'Unrestricted', 'required maxlength="100"')}</div><button>Publish campaign</button></form>`) : '')
}
export const monthlyLabel = (s: Row) => `Monthly ${money(s.amount_cents)} · ${s.status === 'active' ? 'Active' : s.status === 'past_due' ? 'Past due' : s.status === 'canceled' ? 'Cancelled' : s.status}`
export async function donorGiving(c: { db: D1Database }, donorId: string) {
 const plans = await subscriptions(c, donorId)
 if (!plans.length) return ''
 return box('Monthly giving', `<ul class="list">${plans.map(s => `<li><strong>${e(monthlyLabel(s))}</strong><br>${e(s.campaign)}${s.cancel_at_period_end ? '<br>Ends at the close of the billing period.' : ''}${s.recovered ? `<br>${chip('Failed card · Retried successfully', 'ok')}` : s.failed_attempts ? `<br>${chip('Failed card · Stripe retries scheduled', 'warn')}${s.next_attempt_at ? `<br>Next attempt: ${e(new Date(s.next_attempt_at * 1000).toISOString().slice(0, 16).replace('T', ' '))} UTC` : ''}` : ''}</li>`).join('')}</ul>`)
}
