import type { Bindings } from '../auth.server'
import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, id, integer, newId, one, sql, text, today, type Context, type Row, type Stmt } from './db'
import { amount } from './money'
import { settings } from './settings'

export interface GiftRulesEnv extends Bindings { GIFT_RULE_SLACK_URL?: string }
const kinds = ['amount_call', 'first_tag', 'fund_notify'] as const
const providers = ['slack'] as const

/** Slack incoming webhook protocol: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/
 * Destinations are private installation settings, never accepted in a rule or
 * returned by the API. Publishing explicitly authorizes this one team notice. */
function destination(env: GiftRulesEnv | undefined, provider: string): string {
 choice(provider, providers, 'Slack incoming webhook')
 const raw = env?.GIFT_RULE_SLACK_URL
 let url: URL
 try { url = new URL(raw ?? '') } catch { fail('NOT_CONNECTED', 'Configure the selected team notification webhook before publishing.') }
 if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' || url.port || url.username || url.password || url.hash || url.search || !/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)) fail('NOT_CONNECTED', 'Configure a Slack incoming webhook before publishing.')
 return url.href
}

export async function giftRulesState(c: Context) {
 const [rules, firings, tags, owners] = await Promise.all([
  all(c, 'SELECT * FROM cf_gift_rules ORDER BY created_at,id'),
  all(c, 'SELECT * FROM cf_gift_rule_firings ORDER BY created_at DESC LIMIT 200'),
  all(c, 'SELECT t.* FROM cf_donor_rule_tags t JOIN cf_donors d ON d.id=t.donor_id WHERE d.erased_at IS NULL ORDER BY t.created_at DESC LIMIT 200'),
  all(c, "SELECT id,display_name AS name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY display_name,id"),
 ])
 return { rules, firings, tags, owners }
}

export async function giftRulesCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['giftRule.save', 'giftRule.publish', 'giftRule.pause'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin'], 'manage gift rules')
 const existing = p.ruleId ? await one(c, 'SELECT * FROM cf_gift_rules WHERE id=?', id(p.ruleId, 'Rule')) : null
 if (p.ruleId && !existing) fail('NOT_FOUND', 'That gift rule does not exist.', 404)
 const version = existing ? integer(Number(p.version), 'Rule version', 1) : 0
 const checks: Stmt[] = existing ? [guard('EXISTS(SELECT 1 FROM cf_gift_rules WHERE id=? AND version=?)', 'VERSION', 'The rule changed. Refresh before saving.', existing.id, version)] : []
 let rule: Row
 if (command === 'giftRule.save') {
  const kind = choice(p.kind, kinds, 'gift rule action')
  rule = { id: existing?.id ?? newId(), version: version + 1, name: text(p.name, 'Rule name', 100), kind,
   minimum_cents: kind === 'amount_call' ? amount(p, 'minimum', 'Minimum gift') : null,
   owner_id: kind === 'amount_call' ? id(p.ownerId, 'Call owner') : null,
   tag: kind === 'first_tag' ? text(p.tag, 'Tag', 80) : null,
   fund: kind === 'fund_notify' ? text(p.fund, 'Fund', 100) : null,
   provider: kind === 'fund_notify' ? choice(p.provider, providers, 'team notification provider') : null,
   published_at: null, published_by: null, created_at: existing?.created_at ?? c.now }
 } else {
  if (!existing) fail('INPUT', 'Choose a saved rule.', 400)
  if (command === 'giftRule.publish' && p.reviewed !== true && p.reviewed !== 'yes') fail('REVIEW_REQUIRED', 'Review the action and authorize it before publishing.', 400)
  rule = { ...existing, version: version + 1, published_at: command === 'giftRule.publish' ? c.now : null, published_by: command === 'giftRule.publish' ? c.actor.id : null }
  if (command === 'giftRule.publish' && rule.kind === 'fund_notify') destination(c.env, rule.provider)
 }
 if (rule.owner_id) checks.push(guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'Choose an active staff member for the call.', rule.owner_id))
 const columns = ['id','version','name','kind','minimum_cents','owner_id','tag','fund','provider','published_at','published_by','created_at']
 await commit(c, [...checks,
  sql(`INSERT INTO cf_gift_rules(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(k => `${k}=excluded.${k}`).join(',')}`, ...columns.map(k => rule[k])),
  sql('INSERT INTO cf_gift_rule_versions VALUES(?,?,?,?,?)', rule.id, rule.version, JSON.stringify(rule), c.now, c.actor.id),
  event(c, command, 'gift_rule', rule.id, null, { version: rule.version, kind: rule.kind, reviewed: command === 'giftRule.publish' }),
 ])
 return rule
}

/** Explicitly called only after a committed live gift. Imported targets never
 * invoke this door; revision/source checks also exclude historical imports. */
export async function runGiftRules(env: GiftRulesEnv, giftId: string): Promise<void> {
 const c: Context = { db: env.DB, env, now: new Date().toISOString(), actor: { id: 'coffer-gift-rules', name: 'Published gift rules', role: 'owner' }, authority: { sql: '1', params: [] } }
 const gift = await one(c, `SELECT g.* FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
  WHERE g.id=? AND g.kind='gift' AND g.source IN ('manual','stripe') AND d.erased_at IS NULL AND d.constituent_status='active'
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM cf_import_revisions WHERE kind='gift' AND id=g.id)
  AND NOT EXISTS(SELECT 1 FROM cf_gift_rule_arrivals WHERE gift_id=g.id)`, giftId)
 if (!gift) return
 const [rules, s, otherGift, allocations] = await Promise.all([
  all(c, 'SELECT * FROM cf_gift_rules WHERE published_at IS NOT NULL AND published_at<=? ORDER BY id', gift.created_at), settings(c),
  one(c, `SELECT id FROM cf_gifts WHERE donor_id=? AND kind='gift' AND id<>?
   UNION ALL SELECT id FROM cf_in_kind_gifts WHERE donor_id=? LIMIT 1`, gift.donor_id, gift.id, gift.donor_id),
  all(c, 'SELECT fund FROM cf_gift_allocations WHERE gift_id=?', gift.id),
 ])
 const token = newId(), owns = 'EXISTS(SELECT 1 FROM cf_gift_rule_arrivals WHERE gift_id=? AND token=?)'
 const writes: Stmt[] = [guard("EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND d.erased_at IS NULL AND d.constituent_status='active') AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=?)", 'GIFT_CHANGED', 'The gift or donor changed during rule processing.', gift.id, gift.id), sql('INSERT OR IGNORE INTO cf_gift_rule_arrivals VALUES(?,?,?)', gift.id, token, c.now)]
 const notices: Row[] = []
 for (const rule of rules) {
  if (!(rule.kind === 'amount_call' ? gift.amount_cents >= rule.minimum_cents : rule.kind === 'first_tag' ? !otherGift : allocations.length ? allocations.some(a => a.fund === rule.fund) : gift.fund === rule.fund)) continue
  // Recheck first-recorded-gift eligibility in the action transaction too.
  const ruleOwns = rule.kind === 'first_tag' ? `${owns} AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE donor_id=? AND kind='gift' AND id<>?) AND NOT EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE donor_id=?)` : owns
  const ruleParams = rule.kind === 'first_tag' ? [gift.id, token, gift.donor_id, gift.id, gift.donor_id] : [gift.id, token]
  // Configuration must still be exactly the published human-reviewed version.
  writes.push(guard('EXISTS(SELECT 1 FROM cf_gift_rules WHERE id=? AND version=? AND published_at IS NOT NULL)', 'RULE_CHANGED', 'A published gift rule changed during gift processing.', rule.id, rule.version))
  const taskId = rule.kind === 'amount_call' ? newId() : null
  const dueAt = new Date(Date.parse(gift.created_at) + 48 * 3600000).toISOString()
  const activeOwner = rule.kind !== 'amount_call' || !!await one(c, "SELECT id FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member')", rule.owner_id)
  if (taskId && activeOwner) writes.push(guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))", 'OWNER_CHANGED', 'The gift rule call owner changed.', rule.owner_id))
  writes.push(sql(`INSERT INTO cf_gift_rule_firings(rule_id,gift_id,rule_version,action,status,task_id,due_at,created_at)
   SELECT ?,?,?,?,?,?,?,? WHERE ${ruleOwns}`, rule.id, gift.id, rule.version, rule.kind, !activeOwner ? 'owner_unavailable' : rule.kind === 'fund_notify' ? 'sending' : 'complete', activeOwner ? taskId : null, taskId ? dueAt : null, c.now, ...ruleParams))
  if (taskId && activeOwner) writes.push(sql(`INSERT INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask)
   SELECT ?,?,?,'gift',?,?,?,?,?,0 WHERE ${ruleOwns} AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))`, taskId, gift.donor_id, `gift-rule:${rule.id}:${gift.id}`, `Thank-you call: ${rule.name}. Call deadline: ${dueAt}`, gift.amount_cents, rule.owner_id, today(s.timezone, new Date(dueAt)), c.now, ...ruleParams, rule.owner_id))
  if (rule.kind === 'first_tag') writes.push(sql(`INSERT OR IGNORE INTO cf_donor_rule_tags SELECT ?,?,?,?,? WHERE ${ruleOwns}`, gift.donor_id, rule.tag, rule.id, gift.id, c.now, ...ruleParams))
  writes.push(sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,?,?,?,'giftRule.fire','gift_rule',?,?,? WHERE ${ruleOwns}`, c.now, c.actor.id, c.actor.name, c.actor.role, rule.id, gift.donor_id, JSON.stringify({ giftId: gift.id, version: rule.version, kind: rule.kind }), ...ruleParams))
  if (rule.kind === 'fund_notify') notices.push(rule)
 }
 await commit(c, writes)
 if (!(await one(c, 'SELECT gift_id FROM cf_gift_rule_arrivals WHERE gift_id=? AND token=?', gift.id, token))) return
 for (const rule of notices) {
  let status = 'uncertain'
  try {
   const response = await fetch(destination(env, rule.provider), { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `A new gift includes ${rule.fund}. Total gift: $${(gift.amount_cents / 100).toFixed(2)}. Open Coffer to review gift ${gift.id}.` }) })
   status = response.status === 200 && (await response.text()).trim() === 'ok' ? 'submitted' : 'rejected'
  } catch { /* A lost network result is visible and never retried automatically. */ }
  await commit(c, [sql('UPDATE cf_gift_rule_firings SET status=?,completed_at=? WHERE rule_id=? AND gift_id=? AND status=\'sending\'', status, new Date().toISOString(), rule.id, gift.id), event(c, 'giftRule.notification', 'gift_rule', rule.id, gift.donor_id, { giftId: gift.id, status })])
 }
}
