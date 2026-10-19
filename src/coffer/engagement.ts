import { requireRole } from './auth'
import { addDays, all, commit, daysBetween, event, fail, guard, integer, one, sql, today, type Context, type Row } from './db'
import { settings } from './settings'

export const ENGAGEMENT_COMPONENTS = ['recency', 'frequency', 'amount', 'conversations', 'volunteering'] as const
export type EngagementWeights = Record<typeof ENGAGEMENT_COMPONENTS[number], number>
export type EngagementPolicy = { version: number; weights: EngagementWeights; formula: typeof ENGAGEMENT_FORMULA; updatedAt: string | null }
export const ENGAGEMENT_FORMULA = {
 windowDays: 365,
 recency: [{ throughDays: 30, basePoints: 25 }, { throughDays: 90, basePoints: 15 }, { throughDays: 365, basePoints: 5 }],
 frequency: { pointsPerGift: 5, cap: 25 },
 amount: { centsPerUnit: 10000, pointsPerUnit: 5, cap: 25 },
 conversations: { pointsPerInteraction: 5, cap: 25 },
 volunteering: { minutesPerUnit: 60, pointsPerUnit: 5, cap: 25 },
 weighting: 'Each component contributes base points × its weight / 25. Weights total 100. Component points and the total are rounded to two decimal places.',
 gifts: 'Only positive, wholly unrefunded gifts dated on or before the organization day score. Pledges, soft credits and planned asks do not score.',
 activity: 'Meaningful recorded calls, meetings and emails score once per interaction, including received replies. Automatic replies and unanswered calls do not score. Reply tasks do not add a second interaction.',
 window: 'The activity and giving window includes today and the preceding 364 calendar days. Recency uses the latest eligible gift or interaction, including older history. Recorded volunteering also participates in recency; volunteering earns 5 base points per complete hour in the activity window, capped at 25, with a default weight of zero until configured.',
 retentionRisk: 'At risk means a donor previously gave a gift with a positive current balance but their last such gift is more than 365 days ago. A donor without giving history has unknown risk. Activity and weights do not reset the giving clock.',
} as const

export async function engagementPolicy(c: { db: D1Database }): Promise<EngagementPolicy> {
 const row = await one(c, 'SELECT * FROM cf_engagement_settings WHERE id=1')
 const weights = Object.fromEntries(ENGAGEMENT_COMPONENTS.map(key => [key, row ? row[key] : key==='volunteering'?0:25])) as EngagementWeights
 return { version: row?.version ?? 1, weights, formula: ENGAGEMENT_FORMULA, updatedAt: row?.updated_at ?? null }
}

export async function engagementCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'engagement.settings') return undefined
 requireRole(c.actor, ['owner', 'admin'], 'change engagement weights')
 const version = integer(Number(p.version), 'Score settings version', 1)
 const weights = Object.fromEntries(ENGAGEMENT_COMPONENTS.map(key => [key, integer(Number(p[key]??(key==='volunteering'?0:undefined)), `${key} weight`, 0, 100)])) as EngagementWeights
 if (Object.values(weights).reduce((sum, value) => sum + value, 0) !== 100) fail('INPUT', 'The engagement weights must add to 100.', 400)
 await commit(c, [
  guard('COALESCE((SELECT version FROM cf_engagement_settings WHERE id=1),1)=?', 'VERSION', 'Score settings changed. Refresh before saving.', version),
  sql(`INSERT INTO cf_engagement_settings(id,version,recency,frequency,amount,conversations,volunteering,updated_at,updated_by)
   VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,recency=excluded.recency,
   frequency=excluded.frequency,amount=excluded.amount,conversations=excluded.conversations,volunteering=excluded.volunteering,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
   version + 1, weights.recency, weights.frequency, weights.amount, weights.conversations, weights.volunteering, c.now, c.actor.id),
  event(c, command, 'engagement_settings', '1', null, { version: version + 1, weights }),
 ])
 return engagementPolicy(c)
}

const round = (value: number) => Math.round(value * 100) / 100
function score(row: Row, asOf: string, policy: EngagementPolicy) {
 const lastOn = [row.last_gift_on, row.last_conversation_on, row.last_volunteer_on].filter(Boolean).sort().at(-1) ?? null
 const days = lastOn ? daysBetween(lastOn, asOf) : null
 const baseRecency = days === null ? 0 : ENGAGEMENT_FORMULA.recency.find(tier => days <= tier.throughDays)?.basePoints ?? 0
 const weighted = (key: keyof EngagementWeights, basePoints: number) => ({ basePoints, weight: policy.weights[key], points: round(basePoints * policy.weights[key] / 25) })
 const recency = { lastOn, days, ...weighted('recency', baseRecency) }
 const frequency = { gifts: row.gift_count, ...weighted('frequency', Math.min(25, row.gift_count * 5)) }
 const amount = { cents: row.gift_cents, ...weighted('amount', Math.min(25, Math.floor(row.gift_cents / 10000) * 5)) }
 const conversations = { count: row.conversation_count, calls: row.calls, meetings: row.meetings, emails: row.emails, replies: row.replies,
  ...weighted('conversations', Math.min(25, row.conversation_count * 5)) }
 const volunteering = { minutes:row.volunteer_minutes, hours:row.volunteer_minutes/60, activities:row.volunteer_count, ...weighted('volunteering',Math.min(25,Math.floor(row.volunteer_minutes/60)*5)) }
 const givingDays = row.last_positive_gift_on ? daysBetween(row.last_positive_gift_on, asOf) : null
 const retentionRisk = { flag: givingDays !== null && givingDays > 365, status: givingDays === null ? 'unknown' : givingDays > 365 ? 'at_risk' : 'current',
  lastGiftOn: row.last_positive_gift_on ?? null, days: givingDays, reason: givingDays === null ? 'No positive-balance giving history.' : givingDays > 365 ? 'No positive-balance gift in more than 365 days.' : 'A positive-balance gift falls within the past 365 days.' }
 return { score: round(recency.points + frequency.points + amount.points + conversations.points + volunteering.points), asOf, policyVersion: policy.version,
  recency, frequency, amount, conversations, volunteering, retentionRisk }
}

/** Compute from native facts on every read. Merge, undo and erasure need no
 * score cache or copied personal data: the underlying stores own custody. */
export async function engagementScores(c: Context, donorId?: string) {
 const [s, policy] = await Promise.all([settings(c), engagementPolicy(c)])
 const asOf = today(s.timezone, new Date(c.now)), since = addDays(asOf, -364)
 const rows = await all(c, `WITH gifts AS (
  SELECT donor_id,MAX(CASE WHEN net_cents=amount_cents THEN received_on END) AS last_gift_on,
   MAX(received_on) AS last_positive_gift_on,
   SUM(CASE WHEN net_cents=amount_cents AND received_on>=? THEN 1 ELSE 0 END) AS gift_count,
   SUM(CASE WHEN net_cents=amount_cents AND received_on>=? THEN net_cents ELSE 0 END) AS gift_cents
  FROM cf_gift_balances WHERE net_cents>0 AND received_on<=? GROUP BY donor_id
 ), activity AS (
  SELECT i.*,(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END) AS is_reply
  FROM cf_interactions i LEFT JOIN cf_reply_tasks r ON r.id=i.id
  WHERE i.meaningful=1 AND i.occurred_on<=? AND (r.id IS NULL OR r.status<>'filed')
 ), conversations AS (
  SELECT donor_id,MAX(occurred_on) AS last_conversation_on,
   SUM(CASE WHEN occurred_on>=? THEN 1 ELSE 0 END) AS conversation_count,
   SUM(CASE WHEN occurred_on>=? AND kind='call' THEN 1 ELSE 0 END) AS calls,
   SUM(CASE WHEN occurred_on>=? AND kind='meeting' THEN 1 ELSE 0 END) AS meetings,
   SUM(CASE WHEN occurred_on>=? AND kind='email' THEN 1 ELSE 0 END) AS emails,
   SUM(CASE WHEN occurred_on>=? AND is_reply=1 THEN 1 ELSE 0 END) AS replies
  FROM activity GROUP BY donor_id
 ), volunteers AS (
 SELECT donor_id,MAX(occurred_on) AS last_volunteer_on,
 SUM(CASE WHEN occurred_on>=? THEN minutes ELSE 0 END) AS volunteer_minutes,
 SUM(CASE WHEN occurred_on>=? THEN 1 ELSE 0 END) AS volunteer_count
 FROM cf_volunteering WHERE occurred_on<=? GROUP BY donor_id
 ) SELECT d.id AS donorId,d.name,g.last_gift_on,g.last_positive_gift_on,i.last_conversation_on,v.last_volunteer_on,COALESCE(v.volunteer_minutes,0) AS volunteer_minutes,COALESCE(v.volunteer_count,0) AS volunteer_count,
  COALESCE(g.gift_count,0) AS gift_count,COALESCE(g.gift_cents,0) AS gift_cents,
  COALESCE(i.conversation_count,0) AS conversation_count,COALESCE(i.calls,0) AS calls,
  COALESCE(i.meetings,0) AS meetings,COALESCE(i.emails,0) AS emails,COALESCE(i.replies,0) AS replies
 FROM cf_donors d LEFT JOIN gifts g ON g.donor_id=d.id LEFT JOIN conversations i ON i.donor_id=d.id LEFT JOIN volunteers v ON v.donor_id=d.id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
 AND (? IS NULL OR d.id=?) ORDER BY lower(d.name),d.id`,
 since, since, asOf, asOf, since, since, since, since, since, since, since, asOf, donorId ?? null, donorId ?? null)
 return { asOf, timezone: s.timezone, policy, donors: rows.map(row => ({ donorId: row.donorId, name: row.name, engagement: score(row, asOf, policy) })) }
}

export async function donorEngagement(c: Context, donorId: string) {
 return (await engagementScores(c, donorId)).donors[0]?.engagement ?? null
}
