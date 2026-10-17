// Demo data for `rer demo` and the hosted demo (modules/demo runs it once, after
// the owner exists): Copper Hollow Food Pantry, a lived-in US nonprofit with a
// small team, donors and households, a year of one-off, monthly and in-kind
// gifts, pledges, reversals, consent history, acknowledgement letters and
// appeals at every stage, online giving on its Holiday Meals campaign page with
// monthly plans and one recovered card, and the audit trail those leave. Rows go through
// Coffer's own write path (commit) and are shaped by its domain code
// (renderLetter, letterHash, audience, hashOf, the Stripe move-in ids). Fixed ids
// with ON CONFLICT DO NOTHING keep it idempotent; nothing is fetched or sent.
import type { Bindings } from './auth.server'
import { commit, sha256, sql, today, type Context, type Row, type Stmt } from './coffer/db'
import { settings } from './coffer/settings'
import { appealPlan, appeals, letterPlan, letters } from './coffer/demo/outreach'
import { onlineGiving } from './coffer/demo/giving'
import { ledger, teamRows, timeOf, type AuditEvent, type Clock, type Person } from './coffer/demo/ledger'
import { agentKeys, donors, organization, ownerName, team } from './coffer/demo/people'

/** INSERT many rows in one statement, as Coffer's own writes do with json_each. */
function rows(table: string, list: Row[], chunk = 150): Stmt[] {
 if (!list.length) return []
 const columns = Object.keys(list[0]), out: Stmt[] = []
 for (let i = 0; i < list.length; i += chunk)
  out.push(sql(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(c => `json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`, JSON.stringify(list.slice(i, i + chunk))))
 return out
}

export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
 const db = env.DB
 const found = await db.prepare("SELECT id,display_name,version FROM oa_operators WHERE lower(email)=lower(?) AND role='owner' AND status='active'").bind(ownerEmail).first<{ id: string; display_name: string; version: number }>()
 if (!found) throw new Error('The demo pantry needs its owner first')
 const clock: Clock = { today: today(organization.timezone, now), now: now.getTime() }
 const name = found.display_name === 'Owner' ? ownerName : found.display_name
 const owner: Person = { id: found.id, name, role: 'owner' }
 const [marcus, june] = team.map(t => ({ id: t.id, name: t.name, role: t.role }))
 const staff = { owner, marcus, june }
 const agents = { spring: { id: agentKeys[0].id, name: agentKeys[0].label, role: 'agent' }, fall: { id: agentKeys[1].id, name: agentKeys[1].label, role: 'agent' } }
 const c: Context = { db, actor: { ...owner, role: 'owner' }, authority: { sql: '1', params: [] }, now: now.toISOString() }
 const reviewedAt = timeOf(clock, 330, 15)
 const book = ledger(clock, staff)

 // The pantry, its team and its year of giving, in one transaction.
 await commit(c, [
  sql("UPDATE oa_operators SET display_name=? WHERE id=? AND display_name='Owner'", name, owner.id),
  sql('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING', owner.id, Date.parse(timeOf(clock, 362, 9))),
  ...rows('oa_operators', teamRows(clock)),
  sql('UPDATE cf_settings SET version=2,organisation=?,ein=?,timezone=?,reviewed_at=?,reviewed_by=? WHERE id=1 AND version=1 AND reviewed_at IS NULL', organization.name, organization.ein, organization.timezone, reviewedAt, name),
  ...await Promise.all(agentKeys.map(async k => sql('INSERT INTO cf_agent_keys(id,token_hash,label,created_by,creator_version,expires_at,revoked_at,created_at) VALUES(?,?,?,?,?,?,NULL,?) ON CONFLICT DO NOTHING',
   k.id, await sha256(`${k.id}:${crypto.randomUUID()}`), k.label, owner.id, found.version, Date.parse(timeOf(clock, k.created, 10)) + 30 * 86400000, Date.parse(timeOf(clock, k.created, 10))))),
  ...rows('cf_households', book.households),
  ...rows('cf_donors', book.donors),
  ...rows('cf_pledges', book.pledges),
  ...rows('cf_gifts', book.gifts),
  ...rows('cf_consents', book.consents.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).map((k, i) => ({ id: i + 1, ...k }))),
 ])

 // Letters and appeals, frozen from what is now recorded, with the audit trail.
 const s = await settings(c), byId = new Map(book.donors.map(d => [d.id, d]))
 const ack = await letters(clock, s, book.gifts, byId, letterPlan(staff, agents))
 const since = new Map(book.donors.map((d, i) => [d.id, donors[i].since]))
 const out = await appeals(clock, db, appealPlan(staff, agents), since)
 const online = await onlineGiving(clock, s, byId)
 const audit: AuditEvent[] = [
  { at: reviewedAt, actor: owner, action: 'settings.update', subject_kind: 'settings', subject_id: '1', donor_id: null, detail: { version: 2, thresholdCents: s.threshold_cents } },
  ...agentKeys.map(k => ({ at: timeOf(clock, k.created, 10), actor: owner, action: 'agent.create', subject_kind: 'agent', subject_id: k.id, donor_id: null, detail: { expiresAt: Date.parse(timeOf(clock, k.created, 10)) + 30 * 86400000 } })),
  ...book.events, ...ack.events, ...out.events, ...online.events,
 ].sort((a, b) => a.at.localeCompare(b.at))
 await commit(c, [
  ...rows('cf_campaigns', [online.campaign]),
  ...rows('cf_giving_customers', online.customers),
  ...rows('cf_giving_intents', online.intents),
  ...rows('cf_subscriptions', online.plans),
  ...rows('cf_gifts', online.gifts),
  ...rows('cf_campaign_gifts', online.campaignGifts),
  ...rows('cf_subscription_gifts', online.planGifts),
  ...rows('cf_agent_recovery', online.recovery ? [online.recovery] : []),
  ...rows('cf_agent_activity', online.activity),
  sql('UPDATE cf_agent_recovery_settings SET last_run_at=? WHERE id=1 AND last_run_at IS NULL', online.recoveredAt),
  ...rows('cf_ack_batches', ack.batches),
  ...rows('cf_ack_batches', online.batches),
  ...rows('cf_acks', ack.acks),
  ...rows('cf_acks', online.acks),
  ...rows('cf_approvals', online.approvals),
  ...rows('cf_appeals', out.appeals),
  ...rows('cf_appeal_recipients', out.recipients),
  ...rows('cf_approvals', [...ack.approvals, ...out.approvals]),
  ...rows('cf_events', audit.map((e, i) => ({ id: i + 1, at: e.at, actor_id: e.actor.id, actor_name: e.actor.name, actor_role: e.actor.role, action: e.action, subject_kind: e.subject_kind, subject_id: e.subject_id, donor_id: e.donor_id, detail: JSON.stringify(e.detail) }))),
 ])
}
