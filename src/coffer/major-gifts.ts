import { engagementScores } from './engagement'
import { requireRole } from './auth'
import { all, commit, date, event, fail, guard, id, integer, newId, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { amount } from './money'
import { settings } from './settings'
import { opportunityStages, saveOpportunityStages } from './opportunity-stages'
import { closeOpportunity } from './opportunity-close'
export { opportunityStages } from './opportunity-stages'

const liveDonor = (donorId: string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, 'DONOR_CHANGED', 'Choose a current donor who has not been merged or erased.', donorId)

export async function majorGiftCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'prospect.stages') return saveOpportunityStages(c, p)
 if (command === 'prospect.close') return closeOpportunity(c, p)
 if (command !== 'prospect.save') return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'manage major-gift prospects')
 const existingId = optional(p.id, 'Prospect', 100), prospectId = existingId ?? newId()
 const donorId = id(p.donorId, 'Donor'), ownerId = id(p.ownerId, 'Owner'), policy = await opportunityStages(c)
 const stage = policy.stages.find(s => s.id === p.stage)
 if (!stage || stage.outcome !== 'open') fail('INPUT', 'Choose an open pipeline stage. Close an opportunity with its pledge or gift separately.', 400)
 const label = optional(p.label, 'Opportunity name', 200) ?? 'Major gift opportunity'
 const cents = amount(p, 'askAmount', 'Ask amount', { allowZero: true })
 const hasExpected = (p.expectedAmount !== undefined && p.expectedAmount !== '') || (p.expectedAmountCents !== undefined && p.expectedAmountCents !== '')
 const expected = hasExpected ? amount(p, 'expectedAmount', 'Expected amount', { allowZero: true }) : cents
 const probability = integer(Number(p.probability ?? 100), 'Probability (%)', 0, 100)
 const fund = optional(p.fund, 'Fund', 100) ?? 'Unrestricted', campaignId = optional(p.campaignId, 'Campaign', 100)
 const expectedCloseOn = date(p.expectedCloseOn, 'Expected close date'), nextStep = text(p.nextStep, 'Next step', 2000)
 const version = existingId ? integer(Number(p.version), 'Prospect version', 1) : 0
 const statements = [liveDonor(donorId),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND opportunity_stages_version=?)', 'VERSION', 'Pipeline stages changed. Refresh before saving.', policy.version),
  guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose an active owner, admin or member as the prospect owner.', ownerId)]
 if (campaignId) statements.push(guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)', 'CAMPAIGN_CHANGED', 'Choose a campaign for this opportunity’s fund.', campaignId, fund))
 if (existingId) statements.push(
  guard('EXISTS(SELECT 1 FROM cf_prospects WHERE id=? AND donor_id=? AND version=? AND closed_on IS NULL)', 'VERSION', 'This prospect changed or is closed. Refresh before saving your changes.', prospectId, donorId, version),
  sql(`UPDATE cf_prospects SET label=?,stage=?,owner_id=?,ask_amount_cents=?,expected_amount_cents=?,probability_percent=?,fund=?,campaign_id=?,expected_close_on=?,next_step=?,version=version+1,updated_at=?,updated_by=?
   WHERE id=? AND donor_id=? AND version=?`, label, stage.id, ownerId, cents, expected, probability, fund, campaignId, expectedCloseOn, nextStep, c.now, c.actor.id, prospectId, donorId, version))
 else statements.push(sql(`INSERT INTO cf_prospects(id,donor_id,label,stage,owner_id,ask_amount_cents,expected_amount_cents,probability_percent,fund,campaign_id,expected_close_on,next_step,version,created_at,created_by,updated_at,updated_by)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`, prospectId, donorId, label, stage.id, ownerId, cents, expected, probability, fund, campaignId, expectedCloseOn, nextStep, c.now, c.actor.id, c.now, c.actor.id))
 // A donor's first opportunity establishes a relationship portfolio. Later
 // opportunity-owner changes never silently move that relationship.
 const defaultPortfolio = 'existing-' + ownerId
 statements.push(
  sql(`INSERT INTO cf_portfolios(id,name,manager_id,untouched_days,version,created_at,updated_at)
   SELECT ?,'Major gifts — '||display_name,id,90,1,?,? FROM oa_operators WHERE id=?
   AND NOT EXISTS(SELECT 1 FROM cf_portfolios WHERE id=?)
   AND NOT EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?)`, defaultPortfolio, c.now, c.now, ownerId, defaultPortfolio, donorId),
  sql('INSERT INTO cf_portfolio_members SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?)', donorId, defaultPortfolio, today((await settings(c)).timezone, new Date(c.now)), donorId),
  event(c, command, 'prospect', prospectId, donorId, { stage: stage.id, ownerId, askAmountCents: cents, expectedAmountCents: expected, probability, fund, campaignId, version: version + 1 }))
 await commit(c, statements)
 return { id: prospectId, donorId, stage: stage.id, ownerId, askAmountCents: cents, expectedAmountCents: expected, probability, fund, campaignId, expectedCloseOn, version: version + 1 }
}

/** Rounds half a cent upward per opportunity with integer arithmetic, then sums
 * the displayed cents. Never multiply decimal dollar values in a forecast. */
export const weightedOpportunityCents = (cents: number, probability: number) => Number((BigInt(cents) * BigInt(probability) + 50n) / 100n)

export function prospectRecordSelection() {
 return {query:`SELECT p.*,d.name AS donor_name,COALESCE(o.display_name,'Reassignment needed') AS owner_name,o.status AS owner_status,o.role AS owner_role,c.name AS campaign_name
   FROM cf_prospects p JOIN cf_donors d ON d.id=p.donor_id LEFT JOIN oa_operators o ON o.id=p.owner_id LEFT JOIN cf_campaigns c ON c.id=p.campaign_id
   WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
   ORDER BY p.expected_close_on,lower(d.name),p.id`,params:[] as unknown[]}
}

export async function prospects(c: Context): Promise<Row[]> {
 const [rows, scores, policy] = await Promise.all([
  all(c, prospectRecordSelection().query),
  engagementScores(c), opportunityStages(c),
 ])
 const byDonor = new Map(scores.donors.map(d => [d.donorId, d.engagement]))
 return rows.map(row => {
  const stage = policy.stages.find(s => s.id === row.stage)
  return { ...row, stage_label: stage?.label ?? row.stage, outcome: stage?.outcome,
   forecast_cents: row.closed_on ? 0 : weightedOpportunityCents(row.expected_amount_cents, row.probability_percent), engagement: byDonor.get(row.donor_id) }
 })
}

export function filterOpportunities(rows: Row[], url: URL) {
 const stage = url.searchParams.get('stage'), owner = url.searchParams.get('ownerId') ?? url.searchParams.get('managerId'), campaign = url.searchParams.get('campaignId')
 return rows.filter(p => (!stage || p.stage === stage) && (!owner || p.owner_id === owner) && (!campaign || p.campaign_id === campaign))
}
export function opportunityTotals(rows: Row[]) {
 const open = rows.filter(p => !p.closed_on)
 return { opportunities: rows.length, open: open.length, askCents: open.reduce((n, p) => n + p.ask_amount_cents, 0),
  expectedCents: open.reduce((n, p) => n + p.expected_amount_cents, 0), forecastCents: open.reduce((n, p) => n + p.forecast_cents, 0) }
}
export async function opportunityPipeline(c: Context, url: URL) {
 const [rows, policy] = await Promise.all([prospects(c), opportunityStages(c)])
 const opportunities = filterOpportunities(rows, url)
 return { opportunities, totals: opportunityTotals(opportunities), ...policy }
}

/** The caller's authorized merge transaction already inserted the source alias.
 * All opportunities and their pledge/gift links follow the native donor facts. */
export function majorGiftMergeStatements(sourceId: string, targetId: string): Stmt[] {
 if (sourceId === targetId) fail('INPUT', 'Choose two different donors to merge.', 400)
 return [liveDonor(targetId), sql('UPDATE cf_prospects SET donor_id=?,version=version+1 WHERE donor_id=?', targetId, sourceId)]
}
