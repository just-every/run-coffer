import { all, commit, event, fail, newId, one, sql, text, type Context } from '../db'
import { amount } from '../money'
import { requireRole } from '../auth'

const summary = `SELECT c.*,
 (SELECT COALESCE(SUM(g.amount_cents),0) FROM cf_fund_ledger g WHERE g.campaign_id=c.id) AS raised_cents,
 (SELECT COUNT(DISTINCT g.gift_id) FROM cf_fund_ledger g WHERE g.campaign_id=c.id AND g.kind='gift' AND g.source<>'stripe-adjustment') AS gift_count,
 (SELECT COUNT(DISTINCT donor_id) FROM cf_subscriptions s WHERE s.campaign_id=c.id AND s.status IN ('active','trialing','past_due') AND s.cancel_at_period_end=0) AS recurring_donors
 FROM cf_campaigns c`

export const campaigns = (c: { db: D1Database }) => all(c, summary + ' WHERE c.active=1 ORDER BY c.created_at DESC')
export async function campaign(c: { db: D1Database }, slug: string) {
 const row = await one(c, summary + ' WHERE c.slug=? AND c.active=1', slug)
 if (!row) fail('not_found', 'That campaign is not available.', 404)
 return row
}
export async function createCampaign(c: Context, input: Record<string, any>) {
 requireRole(c.actor, ['owner', 'admin'], 'publish campaigns')
 const id = newId(), name = text(input.name, 'Campaign name', 120), slug = text(input.slug, 'Page address', 80)
 if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('INPUT', 'Use lowercase letters, numbers and single hyphens for the page address.', 400)
 const description = text(input.description, 'Campaign description', 2000), fund = text(input.fund, 'Fund', 100), goal = amount(input, 'goal', 'Campaign goal')
 await commit(c, [sql('INSERT INTO cf_campaigns(id,slug,name,description,fund,goal_cents,created_at) VALUES(?,?,?,?,?,?,?)', id, slug, name, description, fund, goal, c.now), event(c, 'campaign.create', 'campaign', id, null)])
 return { id, slug }
}
export const subscriptions = (c: { db: D1Database }, donorId: string) => all(c, 'SELECT s.*,c.name AS campaign FROM cf_subscriptions s JOIN cf_campaigns c ON c.id=s.campaign_id WHERE s.donor_id=? ORDER BY s.updated_at DESC', donorId)
