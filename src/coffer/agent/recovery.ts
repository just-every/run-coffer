import { reconcileNativeRecovery } from '../giving/installments'
import { recoveryPolicyRequired, policyConfigured, legacyRecoveryPolicy } from './recovery-notices-rules'
import { advanceRecoveryNotices, settleRecoveryNotices } from './recovery-notices'
import { automated, automationContext, automationAllows, automationRecords, claimAutomation } from '../automation-grants'
import { manager } from '../auth'
import { all, choice, commit, event, fail, guard, one, sql, text, type Context, type Row } from '../db'
import { emailPortalLink } from '../giving/portal'
import { stripeId } from '../giving/recording'
import { available, managed, requireStripe, stripe, type GivingEnv } from '../giving/stripe'
import { invoice } from '../giving/webhooks'
import { action, activityStatement } from './activity'
import { cardExpiryNotices, checkCardExpiry } from './card-expiry'
import { today, newId } from '../db'
import { settings as cofferSettings } from '../settings'

function authorize(c: Context) {
 if (!manager(c.actor) && !(automated(c) && c.automation.id === 'recovery')) fail('FORBIDDEN', 'Only the owner or an admin can manage recovery.', 403)
}

/** Observe current provider state, never the potentially stale webhook payload. */
export async function observeRecovery(env: GivingEnv, current: Row, sub: Row, intent: Row, failureEventId?: string, at=new Date().toISOString()) {
 const c = await automationContext(env,'recovery',at)
 if(!c || !automationAllows(c,intent.donor_id))return
 const previous = await one(c, 'SELECT * FROM cf_agent_recovery WHERE invoice_id=?', current.id)
 const failed = ['open','void','uncollectible'].includes(current.status) && current.attempt_count > 0
 if (!previous && !failed) return
 const state = current.status === 'paid' && current.amount_paid > 0 ? 'recovered'
  : ['void', 'uncollectible'].includes(current.status) || ['unpaid', 'canceled', 'incomplete_expired'].includes(sub.status) ? 'lapsed' : 'waiting'
 const next = state === 'waiting' ? current.next_payment_attempt ?? null : null
 await claimAutomation(c,'recovery.observe',1,intent.donor_id)
 const changed = !previous || previous.state!==state || previous.attempt_count!==(current.attempt_count??0) || previous.next_attempt_at!==next
 await commit(c,[sql(`INSERT INTO cf_agent_recovery(invoice_id,subscription_id,state,attempt_count,next_attempt_at,created_at,last_checked_at)
  VALUES(?,?,?,?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET state=excluded.state,attempt_count=excluded.attempt_count,
  next_attempt_at=excluded.next_attempt_at,last_checked_at=excluded.last_checked_at
  WHERE (state<>'recovered' OR excluded.state='recovered') AND
  (state<>excluded.state OR attempt_count<>excluded.attempt_count OR next_attempt_at IS NOT excluded.next_attempt_at)`
  ,current.id, sub.id, state, current.attempt_count ?? 0, next, c.now, c.now),sql('UPDATE cf_agent_recovery SET last_checked_at=? WHERE invoice_id=?',c.now,current.id)])
 if (changed) await action(c, {
  kind: `recovery.${state}`, subjectId: current.id,
  summary: state === 'recovered' ? 'Monthly gift recovered at Stripe; the paid gift is recorded.' : state === 'lapsed' ? 'Monthly gift lapsed at Stripe.' : 'Failed monthly gift is waiting on Stripe recovery.',
  why: `Current Stripe invoice and subscription state: ${current.status}; ${sub.status}. Stripe owns the retry schedule.`,
 })
 await settleRecoveryNotices(c,sub.id,current.id,state,state==='recovered'?new Date(current.status_transitions.paid_at*1000).toISOString():c.now)
 if (state === 'lapsed') await exhaustedTask(c,current.id,sub.id)
 if (state !== 'waiting' || previous?.state === 'recovered') return
 if(await policyConfigured(c)||await recoveryPolicyRequired(c,sub.id)){await advanceRecoveryNotices(c,env,sub.id,current.id,'failure',intent.amount_cents,previous?.created_at??c.now);return}
 // One atomic claim across duplicate events and concurrent Worker instances.
 // A crash after the claim is deliberately visible as uncertain; sending again
 // would risk duplicate mail because emailPortalLink has no idempotent delivery API.
 if(previous && previous.notice_state!=='pending')return
 await claimAutomation(c,'recovery.notice',1,intent.donor_id)
 const claimId=newId()
 await commit(c,[guard(legacyRecoveryPolicy,'POLICY_CHANGED','An explicit recovery notice policy now controls sending.'),sql(`UPDATE cf_agent_recovery SET notice_state='sending',notice_event_id=?,notice_at=?,notice_claim_id=?
  WHERE invoice_id=? AND notice_state='pending' AND state='waiting'`,failureEventId??null,c.now,claimId,current.id)])
 if(!await one(c,'SELECT invoice_id FROM cf_agent_recovery WHERE invoice_id=? AND notice_claim_id=?',current.id,claimId))return
 await action(c, { kind: 'recovery.card_link_requested', subjectId: current.id, summary: 'Requested one private card-update email.', why: 'The monthly invoice failed. Email cannot be unsent; an interrupted send needs review before any new invitation.' })
 let notice = 'failed'
 try { notice = await emailPortalLink(env, intent.donor_id, 'Update your card for your monthly gift',{authorize:()=>commit(c,[guard(legacyRecoveryPolicy,'POLICY_CHANGED','An explicit recovery notice policy now controls sending.'),guard("EXISTS(SELECT 1 FROM cf_agent_recovery WHERE invoice_id=? AND state='waiting' AND notice_claim_id=?)",'RECOVERY_STOPPED','The recovery notice was stopped.',current.id,claimId)])}) ? 'sent' : 'skipped' } catch { /* Persist failure; never automatically repeat an uncertain external send. */ }
 await commit(c,[sql('UPDATE cf_agent_recovery SET notice_state=?,notice_at=? WHERE invoice_id=?',notice,new Date().toISOString(),current.id)])
 await action(c, { kind: `recovery.card_link_${notice}`, subjectId: current.id, summary: notice === 'sent' ? 'Private card-update email accepted by the mail provider.' : notice === 'skipped' ? 'Card-update email unavailable: donor has no deliverable account.' : 'Card-update email failed or its delivery is uncertain.', why: notice === 'sent' ? 'The donor can update their card in the secure giving portal. This email cannot be unsent.' : 'No automatic resend is scheduled. Review delivery before contacting the donor through the existing giving portal.' })
}

export async function recoveryData(c: Context) {
 const settings = await one(c, 'SELECT enabled,last_run_at FROM cf_agent_recovery_settings WHERE id=1')
 const rows = await all(c, `SELECT r.*,s.donor_id,d.name AS donor_name,s.amount_cents,s.status AS subscription_status
  FROM cf_agent_recovery r JOIN cf_subscriptions s ON s.id=r.subscription_id JOIN cf_donors d ON d.id=s.donor_id
  WHERE d.erased_at IS NULL ORDER BY CASE r.state WHEN 'waiting' THEN 0 WHEN 'lapsed' THEN 1 ELSE 2 END,r.last_checked_at DESC LIMIT 100`)
 return { enabled: settings?.enabled === 1, lastRunAt: settings?.last_run_at ?? null, rows, expiryNotices: await cardExpiryNotices(c) }
}

/** Daily/manual reconciliation only: never creates an invoice or attempts a charge. */
export async function runRecovery(c: Context, env: GivingEnv) {
 authorize(c)
 const settings = await one(c, 'SELECT enabled FROM cf_agent_recovery_settings WHERE id=1')
 if (!settings?.enabled) return { enabled: false, checked: 0, recovered: 0, lapsed: 0, errors: 0 }
 if (!available(env)) {
  if (managed(env)) return { enabled: true, checked: 0, recovered: 0, lapsed: 0, errors: 0, unavailable: 'Stripe recovery is not available yet on RER Managed.' }
  requireStripe(env)
 }
 await commit(c, [sql('UPDATE cf_agent_recovery_settings SET last_run_at=? WHERE id=1', c.now)])
 const scope=automationRecords(c,'d.id')
 const subscriptions = await all(c, `SELECT DISTINCT s.id FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id
  WHERE d.erased_at IS NULL AND ${scope.sql} AND (s.status IN ('active','trialing','past_due','unpaid','incomplete') OR EXISTS
  (SELECT 1 FROM cf_agent_recovery r WHERE r.subscription_id=s.id AND r.state='waiting')) ORDER BY s.id`,...scope.params)
 const result = { enabled: true, checked: 0, recovered: 0, lapsed: 0, errors: 0 }
 for (const sub of subscriptions) {
  try {
   if(await reconcileNativeRecovery(c,env,sub.id)){result.checked++;continue}
   // Check each tracked invoice too: a subscription may already have advanced to
   // a newer invoice while an earlier failure was paid or written off.
   const tracked = await all(c, "SELECT invoice_id FROM cf_agent_recovery WHERE subscription_id=? AND state='waiting'", sub.id)
   await commit(c,[])
   const current = await stripe(env, '/subscriptions/' + encodeURIComponent(sub.id))
   const ids = new Set(tracked.map(row => row.invoice_id as string))
   const latest = stripeId(current.latest_invoice)
   if (latest) ids.add(latest)
   for (const id of ids) { await invoice(env, id); result.checked++ }
   await checkCardExpiry(c,env,current)
  } catch {
   result.errors++
   await action(c, { kind: 'recovery.reconcile_failed', subjectId: sub.id, summary: 'Stripe recovery reconciliation failed.', why: 'Provider state could not be verified. No extra charge or replacement gift was created. The next scheduled run can reconcile again.' })
  }
 }
 const counts = await one(c, "SELECT SUM(state='recovered') AS recovered,SUM(state='lapsed') AS lapsed FROM cf_agent_recovery WHERE last_checked_at>=?", c.now)
 result.recovered = counts?.recovered ?? 0; result.lapsed = counts?.lapsed ?? 0
 await action(c, { kind: 'recovery.run', subjectId: 'recovery-schedule', summary: `Reconciled ${result.checked} Stripe invoices; ${result.errors} subscriptions need another check.`, why: 'Daily or operator-requested reconciliation reads Stripe state and records outcomes. Stripe alone schedules payment retries.' })
 return result
}

export async function recoveryAction(c: Context, _env: GivingEnv, input: Row) {
 authorize(c)
 const requested = choice(input.action, ['pause', 'resume'] as const, 'a recovery schedule action'), why = text(input.why, 'Reason', 1000)
 const enabled = requested === 'resume' ? 1 : 0
 const previous = await one(c, 'SELECT enabled FROM cf_agent_recovery_settings WHERE id=1')
 if (previous?.enabled === enabled) return { enabled: Boolean(enabled) }
 const recorded = activityStatement(c, { kind: `recovery.${requested}`, subjectId: 'recovery-schedule', summary: `${enabled ? 'Resumed' : 'Paused'} Coffer recovery reconciliation. Stripe payment retries continue under Stripe settings.`, why, undoKind: 'recovery.schedule', undoData: { action: previous?.enabled ? 'resume' : 'pause' } })
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_agent_recovery_settings WHERE id=1 AND enabled=?)', 'RECOVERY_CHANGED', 'The recovery schedule changed. Refresh and try again.', previous?.enabled),
  sql('UPDATE cf_agent_recovery_settings SET enabled=? WHERE id=1', enabled), recorded.statement, event(c, `recovery.${requested}`, 'agent', 'recovery-schedule', null)])
 return { enabled: Boolean(enabled) }
}

/** A current relationship manager owns follow-up; otherwise the installation owner. */
async function exhaustedTask(c: Context, invoiceId: string, subscriptionId: string) {
 if(await one(c,'SELECT id FROM cf_call_tasks WHERE source_key=?','recovery:'+invoiceId))return
 await claimAutomation(c,'recovery.task')
 const taskId=newId(), day=today((await cofferSettings(c)).timezone,new Date(c.now))
 const owner=`COALESCE((SELECT o.id FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id JOIN oa_operators o ON o.id=p.manager_id WHERE m.donor_id=s.donor_id AND o.status='active' AND o.role IN ('owner','admin','member')),(SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1))`
 await commit(c,[sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask)
  SELECT ?,s.donor_id,?,'recovery','Stripe retries exhausted; review the monthly gift with its donor.',s.amount_cents,${owner},?,?,0
  FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=? AND d.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) AND ${owner} IS NOT NULL`,taskId,'recovery:'+invoiceId,day,c.now,subscriptionId),
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,?,?,?,'recovery.task_created','task',id,donor_id,'{}' FROM cf_call_tasks WHERE id=?`,c.now,c.actor.id,c.actor.name,c.actor.role,taskId)])
}
