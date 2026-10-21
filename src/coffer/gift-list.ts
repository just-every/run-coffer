// The Gifts screen's reads: every recorded gift, newest first, with its donor,
// monthly plan, campaign and acknowledgement state, filtered by tab and by the
// strip's scope (one campaign, or one fund in a year); plus the selected donor's
// card-retry history and the overnight work line.
import { withGiftAcknowledgments } from './gift-acknowledgments'
import { manager } from './auth'
import { DUE } from './acknowledgements'
import { addDays, all, one, today, type Context, type Row } from './db'
import { fundTotals } from './gift-splits'
import { lapses } from './lapses'
import { settings } from './settings'

export const GIFT_TABS = ['all', 'attention', 'letters', 'monthly'] as const
export type GiftTab = typeof GIFT_TABS[number]
/** One working screen of rows: the ledger, its footer and the donor panel share the first screen at 1440 by 900. */
export const GIFT_PAGE = 12
/** The strip's figures are the ledger's rows for one campaign, or for one fund in one calendar year. */
export type GiftScope = { campaign: string } | { fund: string; year: string } | null

const COLUMNS = `SELECT g.id,g.donor_id,g.kind,g.received_on,g.amount_cents,g.method,g.reference,g.fund,g.goods,g.source,g.pledge_id,g.created_at,
 d.name AS donor_name,d.city,d.region,
 (SELECT r.id FROM cf_gifts r WHERE r.reverses=g.id) AS reversed_by,
 s.id AS plan_id,s.status AS plan_status,s.failed_attempts,s.recovered,
 (SELECT c.name FROM cf_campaign_gifts cg JOIN cf_campaigns c ON c.id=cg.campaign_id WHERE cg.gift_id=g.id) AS campaign,
 (SELECT COUNT(*) FROM cf_gift_allocations a WHERE a.gift_id=g.id) AS parts,
 (SELECT CASE WHEN a.printed_at IS NOT NULL THEN 'printed' ELSE COALESCE(NULLIF(a.delivery_status,'pending'),b.status) END FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=g.id AND a.live=1) AS ack_status,
 (SELECT b.sent_on FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=g.id AND a.live=1) AS ack_sent_on,
 (SELECT a.batch_id FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1) AS ack_batch
 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
 LEFT JOIN cf_subscription_gifts x ON x.gift_id=g.id LEFT JOIN cf_subscriptions s ON s.id=x.subscription_id
 WHERE g.kind='gift'`
const UNREVERSED = 'NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)'
/** A person must act: goods or services unanswered, a letter past its target, or a monthly card still failing. */
const ATTENTION = `(${UNREVERSED} AND (g.goods='unknown' OR (${DUE} AND g.received_on<?) OR (s.failed_attempts>0 AND s.recovered=0)))`

function filter(tab: GiftTab, threshold: number, overdueBefore: string): [string, unknown[]] {
 if (tab === 'attention') return [ATTENTION, [threshold, overdueBefore]]
 if (tab === 'letters') return [`(${DUE})`, [threshold]]
 if (tab === 'monthly') return ['s.id IS NOT NULL', []]
 return ['1', []]
}

/** The same fund ledger the campaign page and fund report total, so a scope's rows are exactly what its figure counts. */
function scoped(scope: GiftScope): [string, unknown[]] {
 if (!scope) return ['1', []]
 if ('campaign' in scope) return ["g.id IN (SELECT gift_id FROM cf_fund_ledger WHERE kind='gift' AND campaign_id=?)", [scope.campaign]]
 return ["g.id IN (SELECT gift_id FROM cf_fund_ledger WHERE kind='gift' AND fund=? AND received_on>=? AND received_on<=?)", [scope.fund, `${scope.year}-01-01`, `${scope.year}-12-31`]]
}

export async function giftList(c: Context, tab: GiftTab, page: number, scope: GiftScope = null, query = '') {
 const s = await settings(c), day = today(s.timezone), overdueBefore = addDays(day, -s.target_days)
 const [where, params] = filter(tab, s.threshold_cents, overdueBefore), [scopeWhere, scopeParams] = scoped(scope)
 const within = `${scopeWhere} AND (?='' OR g.reference=?)`
 scopeParams.push(query.trim().slice(0,100),query.trim().slice(0,100))
 const [rows, counts, total] = await Promise.all([
  all(c, `${COLUMNS} AND ${where} AND ${within} ORDER BY g.received_on DESC,g.created_at DESC,g.id LIMIT ? OFFSET ?`, ...params, ...scopeParams, GIFT_PAGE, page * GIFT_PAGE),
  one(c, `SELECT (SELECT count(*) FROM (${COLUMNS} AND ${ATTENTION} AND ${within})) AS attention,(SELECT count(*) FROM (${COLUMNS} AND (${DUE}) AND ${within})) AS letters,(SELECT count(*) FROM (${COLUMNS} AND ${within})) AS gifts,(SELECT count(*) FROM (${COLUMNS} AND (${DUE}))) AS letters_all`, s.threshold_cents, overdueBefore, ...scopeParams, s.threshold_cents, ...scopeParams, ...scopeParams, s.threshold_cents),
  one(c, `SELECT count(*) AS n FROM (${COLUMNS} AND ${where} AND ${within})`, ...params, ...scopeParams),
 ])
 await withGiftAcknowledgments(c,rows)
 return { settings: s, today: day, rows, total: Number(total?.n ?? 0), counts: counts as Row }
}

export async function giftById(c: Context, giftId: string) {
 const gift=await one(c, `${COLUMNS} AND g.id=?`, giftId)
 if(gift)await withGiftAcknowledgments(c,[gift])
 return gift
}

/** The strip: the newest active campaign's progress, read from the same fund ledger as its
 * campaign page, beside its fund's total for the year; or the year's giving when none is published. */
export async function giftProgress(c: Context, year: string) {
 const [campaign, totals, payouts] = await Promise.all([
  one(c, `SELECT c.id,c.name,c.fund,c.goal_cents,
   (SELECT COALESCE(SUM(g.amount_cents),0) FROM cf_fund_ledger g WHERE g.campaign_id=c.id) AS raised_cents,
   (SELECT COUNT(DISTINCT g.gift_id) FROM cf_fund_ledger g WHERE g.campaign_id=c.id AND g.kind='gift') AS gift_count,
   (SELECT COUNT(DISTINCT donor_id) FROM cf_subscriptions s WHERE s.campaign_id=c.id AND s.status IN ('active','trialing','past_due') AND s.cancel_at_period_end=0) AS recurring_donors
   FROM cf_campaigns c WHERE c.active=1 ORDER BY c.created_at DESC LIMIT 1`),
  one(c, `SELECT (SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions WHERE received_on>=?) AS year_cents,(SELECT count(*) FROM cf_gifts WHERE kind='gift' AND received_on>=?) AS year_gifts,
   (SELECT count(*) FROM cf_subscriptions WHERE status IN ('active','trialing','past_due') AND cancel_at_period_end=0) AS plans`, `${year}-01-01`, `${year}-01-01`),
  one(c, 'SELECT count(*) AS total,(SELECT count(DISTINCT payout_id) FROM cf_payout_postings) AS posted FROM cf_payouts'),
 ])
 const fund = campaign ? (await fundTotals(c, { from: `${year}-01-01`, through: `${year}-12-31` })).find(f => f.fund === campaign.fund) ?? { fund: campaign.fund, amount_cents: 0, gift_count: 0 } : null
 return { campaign, fund, totals: totals as Row, payouts: payouts as Row }
}

/** The selected donor's panel: totals, card retries, consent, household and the agent's draft. */
export async function donorPanelData(c: Context, donorId: string) {
 const [donor, totals, consent, household, recovery, draft, ai] = await Promise.all([
  one(c, 'SELECT d.id,d.erased_at,d.name,d.email,d.phone,d.address_line1,d.address_line2,d.city,d.region,d.postal_code,h.name AS household,d.household_id FROM cf_donors d LEFT JOIN cf_households h ON h.id=d.household_id WHERE d.id=?', donorId),
  one(c, "SELECT count(*) AS gifts,MIN(received_on) AS first_gift,COALESCE((SELECT SUM(amount_cents) FROM cf_monetary_contributions WHERE donor_id=?),0) AS lifetime_cents FROM cf_gifts WHERE donor_id=? AND kind='gift'", donorId, donorId),
  all(c, 'SELECT channel,status FROM cf_consents k WHERE donor_id=? AND id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=k.donor_id AND channel=k.channel)', donorId),
  one(c, 'SELECT count(*) AS members FROM cf_donors WHERE household_id=(SELECT household_id FROM cf_donors WHERE id=?) AND erased_at IS NULL', donorId),
  one(c, 'SELECT r.*,s.amount_cents FROM cf_agent_recovery r JOIN cf_subscriptions s ON s.id=r.subscription_id WHERE s.donor_id=? ORDER BY r.created_at DESC LIMIT 1', donorId),
  manager(c.actor) ? one(c, "SELECT id,kind,subject,created_at,created_by FROM cf_stewardship_drafts WHERE donor_id=? AND status='draft' ORDER BY created_at DESC LIMIT 1", donorId) : null,
  manager(c.actor) ? one(c, 'SELECT encrypted_key IS NOT NULL AS configured FROM cf_stewardship_setup WHERE id=1') : null,
 ])
 const retries = recovery ? await all(c, "SELECT kind,at,summary FROM cf_agent_activity WHERE subject_id=? AND kind LIKE 'recovery.%' ORDER BY at", recovery.invoice_id) : []
 const recent = await all(c, `SELECT g.received_on,g.amount_cents,g.fund,g.created_at,
  (SELECT CASE WHEN a.printed_at IS NOT NULL THEN 'printed' ELSE COALESCE(NULLIF(a.delivery_status,'pending'),b.status) END FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=g.id AND a.live=1) AS ack_status,
  (SELECT COALESCE(a.delivered_at,b.sent_on,a.printed_at,b.prepared_at) FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=g.id AND a.live=1) AS ack_at
  FROM cf_gifts g WHERE g.donor_id=? AND g.kind='gift' ORDER BY g.received_on DESC,g.created_at DESC LIMIT 2`, donorId)
 return { donor, totals: totals as Row, consent: Object.fromEntries(consent.map(k => [k.channel, k.status])), members: household?.members ?? 0, recovery, retries, recent, agent: manager(c.actor), draft, aiReady: !!ai?.configured }
}

/** The quiet line under the table: the last reconciliation, letters due and the largest lapse to call. */
export async function overnight(c: Context) {
 const boss = manager(c.actor)
 const [run, lapse] = await Promise.all([
  boss ? one(c, "SELECT at,summary FROM cf_agent_runs WHERE job='reconciliation'") : null,
  lapses(c).then(report => report.rows[0] ?? null),
 ])
 return { run: run ? { at: run.at as string, ...JSON.parse(run.summary) } : null, lapse }
}
