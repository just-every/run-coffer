import { all, fail, one } from './db'
import { allocateCents } from './gift-splits'

/** CAMP-001: received money is the signed fund ledger; commitments and
 * recognition are separate. Dates describe the plan, never hide corrections. */
export async function campaignProgress(c: { db: D1Database }, campaignId: string) {
 const campaign = await one(c, 'SELECT * FROM cf_campaigns WHERE id=?', campaignId)
 if (!campaign) fail('NOT_FOUND', 'That campaign does not exist.', 404)
 const scope = await all(c, `WITH RECURSIVE tree AS (
  SELECT * FROM cf_campaigns WHERE id=? UNION ALL SELECT child.* FROM cf_campaigns child JOIN tree p ON child.parent_id=p.id
 ) SELECT * FROM tree`, campaignId)
 const ids = JSON.stringify(scope.map(r => r.id)), within = 'IN (SELECT value FROM json_each(?))'
 const [entries, pledges, credits, recurring, appeals] = await Promise.all([
  all(c, `SELECT l.*,d.name AS donor_name FROM cf_fund_ledger l JOIN cf_donors d ON d.id=l.donor_id WHERE l.campaign_id ${within} ORDER BY l.received_on,l.id,l.position`, ids),
  all(c, `SELECT p.*,p.amount_cents-p.reduced_cents-COALESCE((SELECT SUM(i.paid_cents) FROM cf_pledge_balances i WHERE i.pledge_id=p.id),0)
   -COALESCE((SELECT SUM(g.amount_cents-CASE WHEN g.kind='reversal' THEN -1 ELSE 1 END*COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_allocations a WHERE a.gift_id=COALESCE(g.reverses,g.id)),0)) FROM cf_monetary_contributions g WHERE g.pledge_id=p.id),0) AS outstanding_cents
   FROM cf_pledge_totals p WHERE p.campaign_id ${within}`, ids),
  all(c, `SELECT s.*,MIN(s.amount_cents,g.net_cents) AS recognized_cents FROM cf_soft_credits s JOIN cf_gift_balances g ON g.id=s.gift_id
   JOIN cf_donors hard ON hard.id=g.donor_id JOIN cf_donors soft ON soft.id=s.donor_id
   WHERE g.net_cents>0 AND hard.erased_at IS NULL AND soft.erased_at IS NULL
   AND (EXISTS(SELECT 1 FROM cf_campaign_gifts cg WHERE cg.gift_id=g.id AND cg.campaign_id ${within})
    OR EXISTS(SELECT 1 FROM cf_gift_allocations a WHERE a.gift_id=g.id AND a.campaign_id ${within}))`, ids, ids),
  all(c, `SELECT DISTINCT s.donor_id FROM cf_subscriptions s WHERE s.campaign_id ${within} AND status IN ('active','trialing','past_due') AND cancel_at_period_end=0 AND NOT EXISTS(SELECT 1 FROM cf_portal_subscription_settings p WHERE p.subscription_id=s.id AND p.collection_paused=1)`, ids),
  all(c, `SELECT DISTINCT a.code,a.name FROM cf_appeal_codes a WHERE a.code IN (
   SELECT appeal FROM cf_campaign_appeals WHERE campaign_id ${within} UNION SELECT ga.appeal FROM cf_gift_appeals ga JOIN cf_fund_ledger l ON l.gift_id=ga.gift_id WHERE l.campaign_id ${within}) ORDER BY a.code`, ids, ids),
 ])
 const donors = new Set<string>(), gifts = new Set<string>()
 const balances = new Map<string, number>()
 for (const row of entries) balances.set(row.gift_id, (balances.get(row.gift_id) ?? 0) + row.amount_cents)
 for (const row of entries) if (row.kind === 'gift' && row.source !== 'stripe-adjustment' && (balances.get(row.gift_id) ?? 0) > 0) { donors.add(row.donor_id); gifts.add(row.gift_id) }
 const firsts = donors.size ? await all(c, `SELECT donor_id,id FROM (
  SELECT donor_id,id,ROW_NUMBER() OVER(PARTITION BY donor_id ORDER BY received_on,created_at,id) AS n FROM cf_gift_balances WHERE net_cents>0
 ) WHERE n=1 AND donor_id IN (SELECT value FROM json_each(?))`, JSON.stringify([...donors])) : []
 const parts = credits.length ? await all(c, 'SELECT * FROM cf_gift_allocations WHERE gift_id IN (SELECT value FROM json_each(?)) ORDER BY gift_id,position', JSON.stringify(credits.map(r => r.gift_id))) : []
 const scopeIds = new Set(scope.map(r => r.id))
 let softCreditCents = 0
 for (const credit of credits) {
  const allocations = parts.filter(a => a.gift_id === credit.gift_id)
  if (!allocations.length) softCreditCents += credit.recognized_cents
  else {
   const cents = allocateCents(credit.recognized_cents, allocations.map(a => ({ amountCents: a.amount_cents })))
   softCreditCents += allocations.reduce((sum, a, i) => sum + (scopeIds.has(a.campaign_id) ? cents[i] : 0), 0)
  }
 }
 const raisedCents = entries.reduce((sum, r) => sum + r.amount_cents, 0)
 return { campaign, campaigns: scope, funds: [...new Set(scope.map(r => r.fund))], appeals,
  forms: scope.filter(r => r.active).map(r => ({ campaignId: r.id, name: r.name, path: '/give/' + r.slug })), entries, pledges,
  raisedCents, pledgedOutstandingCents: pledges.reduce((sum, p) => sum + Math.max(0, p.outstanding_cents), 0), softCreditCents,
  giftCount: gifts.size, donorCount: donors.size, newDonors: firsts.filter(r => gifts.has(r.id)).length,
  recurringDonors: recurring.length, averageGiftCents: gifts.size ? Math.round(raisedCents / gifts.size) : 0,
 }
}
