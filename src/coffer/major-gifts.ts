import { requireRole } from './auth'
import { addDays, all, choice, commit, date, daysBetween, event, fail, guard, id, integer, newId, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { amount } from './money'
import { settings } from './settings'

export const PROSPECT_STAGES = ['identify', 'qualify', 'cultivate', 'ask', 'stewardship'] as const
export const PROSPECT_STAGE_LABELS: Record<typeof PROSPECT_STAGES[number], string> = {
 identify: 'Identify', qualify: 'Qualify', cultivate: 'Cultivate', ask: 'Ask', stewardship: 'Stewardship',
}
const liveDonor = (donorId: string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, 'DONOR_CHANGED', 'Choose a current donor who has not been merged or erased.', donorId)

export async function majorGiftCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'prospect.save') return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'manage major-gift prospects')
 const existingId = optional(p.id, 'Prospect', 100), prospectId = existingId ?? newId()
 const donorId = id(p.donorId, 'Donor'), ownerId = id(p.ownerId, 'Owner')
 const stage = choice(p.stage, PROSPECT_STAGES, 'pipeline stage')
 const label = optional(p.label, 'Opportunity name', 200) ?? 'Major gift opportunity'
 const cents = amount(p, 'askAmount', 'Ask amount', { allowZero: true })
 const expectedCloseOn = date(p.expectedCloseOn, 'Expected close date'), nextStep = text(p.nextStep, 'Next step', 2000)
 const version = existingId ? integer(p.version, 'Prospect version', 1) : 0
 const statements = [liveDonor(donorId),
  guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose an active owner, admin or member as the prospect owner.', ownerId)]
 if (existingId) statements.push(
  guard('EXISTS(SELECT 1 FROM cf_prospects WHERE id=? AND donor_id=? AND version=?)', 'VERSION', 'This prospect changed. Refresh before saving your changes.', prospectId, donorId, version),
  sql(`UPDATE cf_prospects SET label=?,stage=?,owner_id=?,ask_amount_cents=?,expected_close_on=?,next_step=?,version=version+1,updated_at=?,updated_by=?
   WHERE id=? AND donor_id=? AND version=?`, label, stage, ownerId, cents, expectedCloseOn, nextStep, c.now, c.actor.id, prospectId, donorId, version))
 else statements.push(sql(`INSERT INTO cf_prospects(id,donor_id,label,stage,owner_id,ask_amount_cents,expected_close_on,next_step,version,created_at,created_by,updated_at,updated_by)
  VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)`, prospectId, donorId, label, stage, ownerId, cents, expectedCloseOn, nextStep, c.now, c.actor.id, c.now, c.actor.id))
 // A donor's first opportunity establishes a relationship portfolio. Later
 // opportunity-owner changes never silently move that relationship.
 const defaultPortfolio = 'existing-' + ownerId
 statements.push(
  sql(`INSERT INTO cf_portfolios(id,name,manager_id,untouched_days,version,created_at,updated_at)
   SELECT ?,'Major gifts — '||display_name,id,90,1,?,? FROM oa_operators WHERE id=?
   AND NOT EXISTS(SELECT 1 FROM cf_portfolios WHERE id=?)
   AND NOT EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?)`, defaultPortfolio,c.now,c.now,ownerId,defaultPortfolio,donorId),
  sql('INSERT INTO cf_portfolio_members SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?)',donorId,defaultPortfolio,today((await settings(c)).timezone,new Date(c.now)),donorId))
 statements.push(event(c, command, 'prospect', prospectId, donorId, { stage, ownerId, askAmountCents: cents, version: version + 1 }))
 await commit(c, statements)
 return { id: prospectId, donorId, stage, ownerId, askAmountCents: cents, expectedCloseOn, version: version + 1 }
}

/** Deterministic, visible policy: four components, each capped at 25 points.
 * A refunded gift (including a partial refund) contributes no engagement.
 * Conversations and gifts in the future never contribute.
 */
function engagement(row: Row, day: string) {
 const lastOn = [row.last_gift_on, row.last_conversation_on].filter(Boolean).sort().at(-1) ?? null
 const days = lastOn ? daysBetween(lastOn, day) : null
 const recency = { lastOn, days, points: days === null ? 0 : days <= 30 ? 25 : days <= 90 ? 15 : days <= 365 ? 5 : 0 }
 const frequency = { gifts: row.gift_count, points: Math.min(25, row.gift_count * 5) }
 const value = { cents: row.gift_cents, points: Math.min(25, Math.floor(row.gift_cents / 10000) * 5) }
 const conversations = { count: row.conversation_count, points: Math.min(25, row.conversation_count * 5) }
 return { score: recency.points + frequency.points + value.points + conversations.points, asOf: day, recency, frequency, amount: value, conversations }
}

export async function prospects(c: Context): Promise<Row[]> {
 const day = today((await settings(c)).timezone, new Date(c.now)), since = addDays(day, -364)
 const rows = await all(c, `WITH gifts AS (
  SELECT g.donor_id,MAX(g.received_on) AS last_gift_on,
   SUM(CASE WHEN g.received_on>=? THEN 1 ELSE 0 END) AS gift_count,
   SUM(CASE WHEN g.received_on>=? THEN g.net_cents ELSE 0 END) AS gift_cents
  FROM cf_gift_balances g WHERE g.net_cents>0 AND g.net_cents=g.amount_cents AND g.received_on<=?
  GROUP BY g.donor_id
 ), conversations AS (
  SELECT donor_id,MAX(occurred_on) AS last_conversation_on,
   SUM(CASE WHEN occurred_on>=? THEN 1 ELSE 0 END) AS conversation_count
  FROM cf_interactions WHERE occurred_on<=? GROUP BY donor_id
 )
 SELECT p.*,d.name AS donor_name,COALESCE(o.display_name,'Reassignment needed') AS owner_name,o.status AS owner_status,o.role AS owner_role,
  g.last_gift_on,i.last_conversation_on,COALESCE(g.gift_count,0) AS gift_count,
  COALESCE(g.gift_cents,0) AS gift_cents,COALESCE(i.conversation_count,0) AS conversation_count
 FROM cf_prospects p JOIN cf_donors d ON d.id=p.donor_id LEFT JOIN oa_operators o ON o.id=p.owner_id
 LEFT JOIN gifts g ON g.donor_id=d.id LEFT JOIN conversations i ON i.donor_id=d.id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
 ORDER BY p.expected_close_on,lower(d.name),p.id`, since, since, day, since, day)
 return rows.map(row => ({ ...row, engagement: engagement(row, day) }))
}

/** Add to the caller's authorized merge transaction. Both donors may have
 * opportunities: retain all of them and invalidate any stale editing forms.
 * The caller has already inserted the source merge alias before this runs.
 */
export function majorGiftMergeStatements(sourceId: string, targetId: string): Stmt[] {
 if (sourceId === targetId) fail('INPUT', 'Choose two different donors to merge.', 400)
 return [liveDonor(targetId), sql('UPDATE cf_prospects SET donor_id=?,version=version+1 WHERE donor_id=?', targetId, sourceId)]
}
