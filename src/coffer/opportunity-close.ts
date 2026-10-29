import { requireRole } from './auth'
import { commit, date, event, fail, guard, id, integer, newId, one, optional, sql, today, type Context, type Row } from './db'
import { amount } from './money'
import { schedule } from './pledges'
import { settings } from './settings'
import { opportunityStages } from './opportunity-stages'

/** Closing and optionally creating the promise are one transaction. A failed
 * link or stale form leaves neither a pledge nor a closed opportunity behind. */
export async function closeOpportunity(c: Context, p: Row) {
 requireRole(c.actor, ['owner', 'admin', 'member'], 'close opportunities')
 const prospectId = id(p.id, 'Opportunity'), version = integer(Number(p.version), 'Opportunity version', 1)
 const [row, policy, config] = await Promise.all([one(c, 'SELECT * FROM cf_prospects WHERE id=?', prospectId), opportunityStages(c), settings(c)])
 if (!row) fail('NOT_FOUND', 'That opportunity does not exist.', 404)
 const stage = policy.stages.find(s => s.id === p.stage)
 if (!stage || stage.outcome === 'open') fail('INPUT', 'Choose a closed won or closed lost stage.', 400)
 const closedOn = date(p.closedOn, 'Closed on')
 if (closedOn > today(config.timezone, new Date(c.now))) fail('INPUT', 'The close date cannot be in the future.', 400)
 const linkKind = p.linkKind ?? (p.pledgeId ? 'pledge' : p.giftId ? 'gift' : 'none')
 let pledgeId: string | null = null, giftId: string | null = null
 const statements = [
  guard(`EXISTS(SELECT 1 FROM cf_prospects p JOIN cf_donors d ON d.id=p.donor_id WHERE p.id=? AND p.version=? AND p.closed_on IS NULL AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'VERSION', 'This opportunity changed or is already closed. Refresh before saving.', prospectId, version),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND opportunity_stages_version=?)', 'VERSION', 'Pipeline stages changed. Refresh before saving.', policy.version),
 ]
 if (stage.outcome === 'won') {
  if (linkKind === 'new_pledge') {
   pledgeId = newId()
   const cents = amount(p, 'amount', 'Pledge amount')
   const installments = schedule(p, closedOn)
   if (installments.reduce((sum, i) => sum + i.cents, 0) !== cents) fail('INPUT', 'Payment installments must add up to the pledge amount.', 400)
   statements.push(sql('INSERT INTO cf_pledges(id,donor_id,amount_cents,pledged_on,due_by,fund,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)', pledgeId, row.donor_id, cents, closedOn, installments.at(-1)!.dueOn, row.fund, c.now, c.actor.name),
    ...installments.map((i, index) => sql('INSERT INTO cf_pledge_installments(id,pledge_id,position,due_on,amount_cents,remind_on) VALUES(?,?,?,?,?,?)', i.id, pledgeId, index + 1, i.dueOn, i.cents, i.remindOn)),
    event(c, 'pledge.create', 'pledge', pledgeId, row.donor_id, { prospectId, amountCents: cents, installments: installments.length }))
  } else if (linkKind === 'pledge') {
   pledgeId = id(p.pledgeId, 'Pledge')
   statements.push(guard('EXISTS(SELECT 1 FROM cf_pledges WHERE id=? AND donor_id=? AND fund=?)', 'PLEDGE_CHANGED', 'Choose a pledge from this prospect and fund.', pledgeId, row.donor_id, row.fund))
  } else if (linkKind === 'gift') {
   giftId = id(p.giftId, 'Gift')
   statements.push(guard(`EXISTS(SELECT 1 FROM cf_gift_balances g WHERE g.id=? AND g.donor_id=? AND g.kind='gift' AND g.net_cents>0 AND EXISTS(SELECT 1 FROM cf_fund_ledger f WHERE f.gift_id=g.id AND f.fund=? AND f.amount_cents>0))`, 'GIFT_CHANGED', 'Choose a received gift with a positive balance for this prospect and fund.', giftId, row.donor_id, row.fund))
  } else fail('INPUT', 'A closed-won opportunity needs its pledge or received gift.', 400)
  statements.push(guard(`NOT EXISTS(SELECT 1 FROM cf_prospects WHERE pledge_id=? OR gift_id=?
   OR (? IS NOT NULL AND gift_id IN (SELECT gift_id FROM cf_pledge_active_allocations a JOIN cf_pledge_installments i ON i.id=a.installment_id WHERE i.pledge_id=?))
   OR (? IS NOT NULL AND pledge_id IN (SELECT i.pledge_id FROM cf_pledge_active_allocations a JOIN cf_pledge_installments i ON i.id=a.installment_id WHERE a.gift_id=?))
   OR (? IS NOT NULL AND gift_id IN (SELECT id FROM cf_gifts WHERE pledge_id=?))
   OR (? IS NOT NULL AND pledge_id=(SELECT pledge_id FROM cf_gifts WHERE id=?)))`, 'LINK_USED', 'That pledge or gift already closes an opportunity, including a linked pledge payment.', pledgeId, giftId, pledgeId, pledgeId, giftId, giftId, pledgeId, pledgeId, giftId, giftId))
 } else if (linkKind !== 'none' || optional(p.pledgeId, 'Pledge', 100) || optional(p.giftId, 'Gift', 100)) fail('INPUT', 'A closed-lost opportunity cannot link a pledge or gift.', 400)
 statements.push(sql('UPDATE cf_prospects SET stage=?,pledge_id=?,gift_id=?,closed_on=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?', stage.id, pledgeId, giftId, closedOn, c.now, c.actor.id, prospectId, version),
  event(c, 'prospect.close', 'prospect', prospectId, row.donor_id, { stage: stage.id, outcome: stage.outcome, pledgeId, giftId, closedOn }))
 await commit(c, statements)
 return { id: prospectId, donorId: row.donor_id, stage: stage.id, pledgeId, giftId, closedOn, version: version + 1 }
}
