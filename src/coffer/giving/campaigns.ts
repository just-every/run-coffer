import { all, commit, date, event, fail, guard, newId, one, optional, sql, text, type Context } from '../db'
import { amount } from '../money'
import { feeCoverConfig } from './fee-cover'
import { requireRole } from '../auth'
import { campaignMedia, mediaStatements } from './media'

const summary = `SELECT c.*,
 (SELECT COALESCE(SUM(g.amount_cents),0) FROM cf_fund_ledger g WHERE g.campaign_id=c.id) AS raised_cents,
 (SELECT COUNT(DISTINCT g.gift_id) FROM cf_fund_ledger g WHERE g.campaign_id=c.id AND g.kind='gift' AND g.source<>'stripe-adjustment') AS gift_count,
 (SELECT COUNT(DISTINCT remaining.donor_id) FROM (SELECT g.donor_id,SUM(g.amount_cents) AS cents FROM cf_fund_ledger g WHERE g.campaign_id=c.id GROUP BY g.donor_id HAVING SUM(g.amount_cents)>0) remaining) AS donor_count,
 (SELECT COUNT(DISTINCT donor_id) FROM cf_subscriptions s WHERE s.campaign_id=c.id AND s.status IN ('active','trialing','past_due') AND s.cancel_at_period_end=0 AND NOT EXISTS(SELECT 1 FROM cf_portal_subscription_settings p WHERE p.subscription_id=s.id AND p.collection_paused=1)) AS recurring_donors
 FROM cf_campaigns c`

export const campaigns = (c: { db: D1Database }, includeInactive=false) => all(c, summary + (includeInactive?'':' WHERE c.active=1') + ' ORDER BY c.created_at DESC')
export async function campaign(c: { db: D1Database }, slug: string) {
 const row = await one(c, summary + ' WHERE c.slug=? AND c.active=1', slug)
 if (!row) fail('not_found', 'That campaign is not available.', 404)
 return row
}
export async function createCampaign(c: Context, raw: Record<string, any> | FormData) {
 requireRole(c.actor, ['owner', 'admin'], 'publish campaigns')
 const input: Record<string, any> = raw instanceof FormData ? Object.fromEntries(raw) : raw
 const media = await campaignMedia(raw), feeCover = feeCoverConfig(input)
 const id = newId(), name = text(input.name, 'Campaign name', 120), slug = text(input.slug, 'Page address', 80)
 if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('INPUT', 'Use lowercase letters, numbers and single hyphens for the page address.', 400)
 const startsOn = optional(input.startsOn, 'Start date'), endsOn = optional(input.endsOn, 'End date'), parentId = optional(input.parentId, 'Parent campaign', 100)
 if (startsOn) date(startsOn, 'Start date')
 if (endsOn) date(endsOn, 'End date')
 const closesOn = optional(input.closesOn, 'Page close date')
 if (closesOn) date(closesOn, 'Page close date')
 if (startsOn && endsOn && startsOn > endsOn) fail('INPUT', 'Campaign start must be on or before its end.', 400)
 const codes = input.appeals === undefined || input.appeals === '' ? [] : typeof input.appeals === 'string' ? input.appeals.split(',').map((x: string) => x.trim()).filter(Boolean) : input.appeals
 if (!Array.isArray(codes) || codes.length > 100 || codes.some(x => typeof x !== 'string' || !x.trim())) fail('INPUT', 'Choose up to 100 defined appeal codes.', 400)
 const description = text(input.description, 'Campaign description', 2000), fund = text(input.fund, 'Fund', 100), goal = amount(input, 'goal', 'Campaign goal')
 await commit(c, [
  ...(parentId ? [guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=?)', 'CAMPAIGN_PARENT', 'Choose an existing parent campaign.', parentId)] : []),
  sql('INSERT INTO cf_campaigns(id,slug,name,description,fund,goal_cents,created_at,starts_on,ends_on,parent_id,closes_on,fee_cover_enabled,fee_cover_rate_bps,fee_cover_fixed_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, slug, name, description, fund, goal, c.now, startsOn, endsOn, parentId, closesOn, feeCover.enabled, feeCover.rate, feeCover.fixed),
  ...mediaStatements(id, media),
  ...[...new Set<string>(codes)].flatMap(code => [guard('EXISTS(SELECT 1 FROM cf_appeal_codes WHERE code=?)', 'APPEAL', 'Choose defined appeal codes.', code), sql('INSERT INTO cf_campaign_appeals(campaign_id,appeal) VALUES(?,?)', id, code)]),
  event(c, 'campaign.create', 'campaign', id, null),
 ])
 return { id, slug }
}
export const subscriptions = (c: { db: D1Database }, donorId: string) => all(c, 'SELECT s.*,c.name AS campaign,p.interval,p.interval_count,p.collection_paused FROM cf_subscriptions s JOIN cf_campaigns c ON c.id=s.campaign_id LEFT JOIN cf_portal_subscription_settings p ON p.subscription_id=s.id WHERE s.donor_id=? ORDER BY s.updated_at DESC', donorId)
