import { pledgePaymentLink } from './pledge-checkout'
import { renderPledgeReminder } from './pledge-templates'
import { adjustPledge, linkPledgePlan } from './pledge-adjustments'
import type { Bindings } from '../auth.server'
import { donorMailUnavailable, sendDonorMail, DonorMailError } from './outbound-mail'
import { requireRole } from './auth'
import { addDays, all, commit, date, event, fail, guard, id, integer, newId, object, one, optional, sql, today, type Context, type Row, type Stmt } from './db'
import { amount, usd } from './money'
import { longDate, settings } from './settings'

/** User-facing availability is also the preflight: suppressed mail is never sent. */
export function pledgeMailUnavailable(env?: Bindings): string | null {
 return donorMailUnavailable(env)
}

export function schedule(p: Row, pledgedOn: string) {
 let rows: unknown = p.installments
 if (rows === undefined && typeof p.schedule === 'string') rows = p.schedule.split(/\r?\n/).filter((s: string) => s.trim()).map((line: string) => {
  const parts = line.split('|').map(s => s.trim())
  if (parts.length !== 2) fail('INPUT', 'Enter each installment as YYYY-MM-DD | amount.', 400)
  return { dueOn: parts[0], amount: parts[1] }
 })
 if (!Array.isArray(rows) || !rows.length || rows.length > 60) fail('INPUT', 'Add 1–60 dated installments.', 400)
 const days = integer(Number(p.reminderDays ?? 7), 'Days before each installment to remind', 1, 365)
 const seen = new Set<string>()
 return rows.map((raw, index) => {
  const row = object(raw, 'Installment'), dueOn = date(row.dueOn, 'Installment due date')
  if (dueOn < pledgedOn || seen.has(dueOn)) fail('INPUT', 'Installment dates must be distinct and on or after the pledge date.', 400)
  seen.add(dueOn)
  return { id: newId(), dueOn, cents: amount(row, 'amount', `Installment ${index + 1} amount`), remindOn: addDays(dueOn, -days) }
 }).sort((a, b) => a.dueOn.localeCompare(b.dueOn))
}

export async function pledgeCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['pledge.create', 'pledge.remind', 'pledge.match', 'pledge.reduce', 'pledge.writeOff', 'pledge.linkPlan'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'manage pledges')
 if (command === 'pledge.linkPlan') return linkPledgePlan(c,p)
 if (command === 'pledge.reduce' || command === 'pledge.writeOff') {
  const pledge=await one(c,'SELECT donor_id FROM cf_pledges WHERE id=?',id(p.pledgeId,'Pledge'))
  if(!pledge) fail('NOT_FOUND','That pledge does not exist.',404)
  return adjustPledge(c,command,p,await pledgeHistory(c,pledge.donor_id))
 }
 if (command === 'pledge.create') {
  const donorId = id(p.donorId, 'Donor'), pledgeId = newId(), cents = amount(p, 'amount', 'Pledge amount')
  const pledgedOn = date(p.pledgedOn, 'Pledged on'), fund = optional(p.fund, 'Fund', 100) ?? 'Unrestricted'
  const installments = schedule(p, pledgedOn), campaignId = optional(p.campaignId, 'Campaign', 100)
  if (installments.reduce((n, row) => n + row.cents, 0) !== cents) fail('INPUT', 'The installment amounts must add up to the pledge amount.', 400)
  await commit(c, [guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)', 'NOT_FOUND', 'That donor does not exist.', donorId),
   ...(campaignId ? [guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)', 'CAMPAIGN_FUND', 'Choose a campaign raising for this pledge’s fund.', campaignId, fund)] : []),
   sql('INSERT INTO cf_pledges(id,donor_id,amount_cents,pledged_on,due_by,fund,created_at,created_by,campaign_id) VALUES(?,?,?,?,?,?,?,?,?)', pledgeId, donorId, cents, pledgedOn, installments.at(-1)!.dueOn, fund, c.now, c.actor.name, campaignId),
   ...installments.map((i, index) => sql('INSERT INTO cf_pledge_installments(id,pledge_id,position,due_on,amount_cents,remind_on) VALUES(?,?,?,?,?,?)', i.id, pledgeId, index + 1, i.dueOn, i.cents, i.remindOn)),
   event(c, command, 'pledge', pledgeId, donorId, { amountCents: cents, installments: installments.length })])
  return { id: pledgeId, amountCents: cents, installments }
 }
 if (command === 'pledge.remind') return remind(c, p)
 const giftId = id(p.giftId, 'Gift'), gift = await one(c, "SELECT * FROM cf_gifts WHERE id=? AND kind='gift'", giftId)
 if (!gift) fail('NOT_FOUND', 'That gift does not exist.', 404)
 await commit(c, await giftInstallmentStatements(c, p, giftId, gift.donor_id, gift.amount_cents, gift.pledge_id))
 return { id: giftId, matched: true }
}

/** Append AFTER gift insertion to the same batch. An allocation always checks
 * the actual gift, fund, donor and current unpaid amounts inside that batch. */
export async function giftInstallmentStatements(c: Context, p: Row, giftId: string, donorId: string, cents: number, pledgeId?: string | null): Promise<Stmt[]> {
 const installmentId = optional(p.installmentId, 'Installment', 100)
 if (!installmentId) {
  if (!pledgeId) return []
  return [guard(`EXISTS(SELECT 1 FROM cf_pledges p JOIN cf_gift_balances g ON g.id=? WHERE p.id=? AND p.donor_id=? AND p.fund=g.fund
   AND NOT EXISTS(SELECT 1 FROM cf_pledge_installments i WHERE i.pledge_id=p.id)
   AND (SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions WHERE pledge_id=p.id)<=p.amount_cents)`, 'PLEDGE', 'Choose an installment for this pledge and use its donor and fund.', giftId, pledgeId, donorId)]
 }
 const installment = await one(c, 'SELECT * FROM cf_pledge_balances WHERE id=?', installmentId)
 if (!installment) fail('NOT_FOUND', 'That installment does not exist.', 404)
 const allocated = await one(c, 'SELECT COALESCE(SUM(amount_cents),0) AS cents FROM cf_pledge_allocations WHERE gift_id=?', giftId)
 const requested = (p.allocationAmount !== undefined && p.allocationAmount !== '') || (p.allocationAmountCents !== undefined && p.allocationAmountCents !== '')
  ? amount(p, 'allocationAmount', 'Amount to match') : Math.min(cents - allocated!.cents, installment.amount_cents - installment.paid_cents)
 if (requested < 1) fail('PLEDGE_PAID', 'This gift or installment has no unmatched balance.')
 return [guard(`EXISTS(SELECT 1 FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id
   JOIN cf_gift_balances g ON g.id=? JOIN cf_donors d ON d.id=p.donor_id AND d.erased_at IS NULL
   WHERE i.id=? AND p.donor_id=? AND g.donor_id=p.donor_id AND g.fund=p.fund AND g.kind='gift'
   AND (g.pledge_id IS NULL OR g.pledge_id=p.id) AND (? IS NULL OR p.id=?)
   AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
   AND i.amount_cents-i.paid_cents>=? AND g.net_cents-(SELECT COALESCE(SUM(a.amount_cents),0) FROM cf_pledge_allocations a WHERE a.gift_id=g.id)>=?
   AND NOT EXISTS(SELECT 1 FROM cf_pledge_allocations a WHERE a.gift_id=g.id AND a.installment_id=i.id))`,
  'PLEDGE_MATCH', 'Use an unreversed gift from this donor and fund, without exceeding either unmatched balance.', giftId, installmentId, donorId, pledgeId ?? null, pledgeId ?? null, requested, requested),
  sql('INSERT INTO cf_pledge_allocations(id,installment_id,gift_id,amount_cents,created_at,created_by) VALUES(?,?,?,?,?,?)', newId(), installmentId, giftId, requested, c.now, c.actor.name),
  event(c, 'pledge.match', 'pledge', installment.pledge_id, donorId, { giftId, installmentId, amountCents: requested })]
}

export async function pledgeHistory(c: { db: D1Database }, donorId: string): Promise<Row[]> {
 const day=today((await settings(c)).timezone)
 const [pledges, installments, adjustments, plans, allocations] = await Promise.all([
  all(c, `SELECT p.*,COALESCE((SELECT SUM(g.amount_cents - CASE WHEN g.kind='reversal' THEN -1 ELSE 1 END *
   COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_allocations a WHERE a.gift_id=COALESCE(g.reverses,g.id)),0))
   FROM cf_monetary_contributions g WHERE g.pledge_id=p.id),0) AS legacy_paid_cents FROM cf_pledge_totals p WHERE p.donor_id=? ORDER BY p.pledged_on DESC,p.id`, donorId),
  all(c, 'SELECT i.*,f.status AS followup_status FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id LEFT JOIN cf_pledge_followups f ON f.installment_id=i.id WHERE p.donor_id=? ORDER BY i.position', donorId),
  all(c,'SELECT a.* FROM cf_pledge_adjustments a JOIN cf_pledges p ON p.id=a.pledge_id WHERE p.donor_id=? ORDER BY a.created_at,a.id',donorId),
  all(c,'SELECT l.* FROM cf_pledge_plans l JOIN cf_pledges p ON p.id=l.pledge_id WHERE p.donor_id=?',donorId),
  all(c,'SELECT a.*,i.pledge_id FROM cf_pledge_allocations a JOIN cf_pledge_installments i ON i.id=a.installment_id JOIN cf_pledges p ON p.id=i.pledge_id WHERE p.donor_id=? ORDER BY a.created_at,a.id',donorId),
 ])
 return pledges.map(p => {
  const rows: Row[] = installments.filter(i => i.pledge_id === p.id).map(i => ({ ...i, remaining_cents: Math.max(0,i.amount_cents-i.paid_cents), due_cents: i.due_on<=day?Math.max(0,i.amount_cents-i.paid_cents):0, overdue_cents:i.due_on<day?Math.max(0,i.amount_cents-i.paid_cents):0 }))
  const paid = p.legacy_paid_cents + rows.reduce((n, i) => n + i.paid_cents, 0)
  return { ...p, paid_cents: paid, remaining_cents: Math.max(0, p.amount_cents - p.reduced_cents - paid), installments: rows, adjustments: adjustments.filter(a=>a.pledge_id===p.id), plan: plans.find(l=>l.pledge_id===p.id)??null, allocations: allocations.filter(a=>a.pledge_id===p.id) }
 })
}

const eligible = `(SELECT status FROM cf_consents k WHERE k.donor_id=d.id AND k.channel='email' ORDER BY k.id DESC LIMIT 1)='granted'
 AND d.erased_at IS NULL AND d.constituent_status='active' AND d.email IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM cf_acks bad WHERE bad.donor_id=d.id AND bad.recipient_email=d.email AND bad.delivery_status IN ('bounced','complained'))`

async function remind(c:Context,p:Row):Promise<Row>{
 const unavailable=pledgeMailUnavailable(c.env);if(unavailable)fail('mail_unavailable',unavailable,503)
 const donorId=optional(p.donorId,'Donor',100),pledgeId=optional(p.pledgeId,'Pledge',100)
 if(p.interactionId&&!donorId&&!pledgeId)fail('INPUT','Choose one donor or pledge when selecting an interaction.',400)
 const s=await settings(c),day=today(s.timezone,new Date(c.now))
 await commit(c,[sql("UPDATE cf_pledge_installments SET reminder_status='uncertain',reminder_note='Submission was interrupted. Check the mail provider before contacting the donor. No automatic resend.' WHERE reminder_status='sending' AND attempt_started_at<=?",new Date(Date.parse(c.now)-15*60_000).toISOString())])
 const due=await all(c,`SELECT i.*,p.donor_id FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
  WHERE i.reminder_status='pending' AND i.remind_on<=? AND i.paid_cents<i.amount_cents AND (? IS NULL OR p.donor_id=?) AND (? IS NULL OR p.id=?) AND ${eligible}
  ORDER BY COALESCE(i.reminder_merge_checked_at,''),i.remind_on,i.id LIMIT 8`,day,donorId,donorId,pledgeId,pledgeId)
 const heldStatus=await all(c,`SELECT d.constituent_status AS status,count(*) AS n FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id WHERE i.reminder_status='pending' AND i.remind_on<=? AND i.paid_cents<i.amount_cents AND (? IS NULL OR p.donor_id=?) AND (? IS NULL OR p.id=?) AND d.constituent_status<>'active' AND d.erased_at IS NULL GROUP BY d.constituent_status`,day,donorId,donorId,pledgeId,pledgeId)
 let submitted=0,uncertain=0,rejected=0;const held:Row[]=[]
 for(const row of due){
  const rendered=await renderPledgeReminder(c,row,{emailType:p.emailType||undefined,interactionId:p.interactionId||undefined}),r=rendered.recipient,blanks:string[]=JSON.parse(rendered.merge_blanks)
  if(rendered.settingsVersion!==s.version)fail('SETTINGS_CHANGED','The organization calendar changed. Run reminders again.')
  const bounced=r.email?await one(c,"SELECT 1 FROM cf_acks WHERE donor_id=? AND recipient_email=? AND delivery_status IN ('bounced','complained')",row.donor_id,r.email):null
  if(blanks.length||!r.email||!r.selected_email_contact_id||bounced){
   const note=blanks.length?'Missing merge fields: '+blanks.join(', ')+'. No email was submitted.':bounced?'The selected email has bounced or complained. No email was submitted.':'No selected email contact. No email was submitted.'
   await commit(c,[sql("UPDATE cf_pledge_installments SET reminder_merge_blanks=?,reminder_merge_checked_at=?,reminder_note=? WHERE id=? AND reminder_status='pending'",rendered.merge_blanks,c.now,note,row.id)])
   held.push({donorId:row.donor_id,installmentId:row.id,fields:blanks,reason:note});continue
  }
  const link=await pledgePaymentLink(c.env,row.id,new Date(c.now))
  if(link)rendered.body+='\n\nPay this installment: '+link
  const attempt=newId()
  await commit(c,[sql(`UPDATE cf_pledge_installments SET reminder_status='sending',attempt_id=?,attempt_started_at=?,recipient_email=?,recipient_contact_id=?,recipient_contact_version=?,reminder_subject=?,reminder_body=?,reminder_template_version=?,reminder_merge_blanks='[]',reminder_merge_checked_at=?
   WHERE id=? AND reminder_status='pending' AND EXISTS(SELECT 1 FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
    WHERE i.id=cf_pledge_installments.id AND i.remind_on<=? AND i.paid_cents<i.amount_cents AND ${eligible} AND d.version=? AND i.amount_cents-i.paid_cents=?
    AND EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.id=? AND cp.version=? AND cp.value=? AND cp.donor_id=d.id AND cp.kind='email' AND cp.active=1))
   AND EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?) AND EXISTS(SELECT 1 FROM cf_pledge_template WHERE id=1 AND version=?)`,attempt,c.now,r.email,r.selected_email_contact_id,r.selected_email_contact_version,rendered.subject,rendered.body,rendered.templateVersion,c.now,row.id,day,rendered.donorVersion,rendered.remainingCents,r.selected_email_contact_id,r.selected_email_contact_version,r.email,rendered.settingsVersion,rendered.templateVersion)])
  const i=await one(c,`SELECT i.*,p.donor_id,p.fund FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id WHERE i.id=? AND i.attempt_id=? AND i.reminder_status='sending' AND ${eligible}
   AND EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.id=i.recipient_contact_id AND cp.version=i.recipient_contact_version AND cp.value=i.recipient_email AND cp.active=1)`,row.id,attempt)
  if(!i||i.amount_cents-i.paid_cents!==rendered.remainingCents||i.recipient_email!==r.email){
   await c.db.prepare("UPDATE cf_pledge_installments SET reminder_status='skipped',recipient_email=NULL,recipient_contact_id=NULL,recipient_contact_version=NULL,reminder_note='The balance or recipient changed before submission. No email was sent.' WHERE id=? AND attempt_id=? AND reminder_status='sending'").bind(row.id,attempt).run();continue
  }
  let state='uncertain',messageId:string|null=null
  try{const sent=await sendDonorMail(c.env!,{deliveryId:attempt,from:c.env!.MAIL_FROM!,to:[i.recipient_email],subject:i.reminder_subject,text:i.reminder_body,customArgs:{coffer_installment_id:i.id,coffer_attempt_id:attempt,coffer_template_version:String(i.reminder_template_version)}});messageId=sent.providerMessageId??null;state=messageId?'submitted':'uncertain'}
  catch(error){if(error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome))state='rejected'}
  const note=state==='submitted'?'Accepted by the mail provider; delivery is not confirmed.':state==='rejected'?'The mail provider did not accept this reminder. No automatic resend.':'Email submission could not be confirmed. Check the mail provider before contacting the donor. No automatic resend.'
  const outcome=[sql("UPDATE cf_pledge_installments SET reminder_status=?,message_id=?,submitted_at=?,reminder_note=? WHERE id=? AND attempt_id=? AND reminder_status='sending'",state,messageId,c.now,note,i.id,attempt),event(c,'pledge.reminder','pledge',i.pledge_id,i.donor_id,{installmentId:i.id,state,templateVersion:i.reminder_template_version})]
  await c.db.batch(outcome.map(s=>c.db.prepare(s.sql).bind(...s.params)))
  if(state==='submitted')submitted++;else if(state==='rejected')rejected++;else uncertain++
 }
 return {submitted,uncertain,rejected,held,excluded:Object.fromEntries(heldStatus.map(r=>[r.status,r.n]))}
}

/** Real Worker scheduled handler calls this; failures stay visible to the host.
 * Unavailable installations do no work and never claim an email as submitted. */
export async function runPledgeReminders(env: Bindings, at = new Date()): Promise<Row> {
 const unavailable = pledgeMailUnavailable(env)
 if (unavailable) return { submitted: 0, unavailable }
 return remind({ db: env.DB, env, now: at.toISOString(), actor: { id: 'coffer-scheduler', name: 'Pledge scheduler', role: 'owner' }, authority: { sql: 'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)', params: [] } }, {})
}

/** Minute Cron creates one ordinary call task per overdue installment. The
 * INSERT rechecks the balance, donor and assignee inside the audited transaction;
 * manual creation and concurrent or replayed ticks share the same unique source. */
export async function advancePledgeTasks(env: Bindings, at: Date) {
 const c: Context = { db: env.DB, env, now: at.toISOString(), actor: { id: 'coffer-scheduler', name: 'Pledge scheduler', role: 'owner' }, authority: { sql: 'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)', params: [] } }
 const day = today((await settings(c)).timezone, at)
 const current = `FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
  WHERE i.due_on<? AND i.paid_cents<i.amount_cents AND d.erased_at IS NULL AND d.constituent_status='active'
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM cf_call_tasks t WHERE t.source_key='pledge:'||i.id)`
 const due = await all(c, 'SELECT i.id '+current+' ORDER BY i.due_on,i.id LIMIT 100', day)
 const owner = `COALESCE((SELECT o.id FROM cf_portfolio_members m JOIN cf_portfolios f ON f.id=m.portfolio_id
  JOIN oa_operators o ON o.id=f.manager_id WHERE m.donor_id=p.donor_id AND o.status='active' AND o.role IN ('owner','admin','member')),
  (SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1))`
 for (const i of due) {
  const taskId = newId()
  await commit(c, [
   sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask)
    SELECT ?,p.donor_id,'pledge:'||i.id,'pledge','Unpaid '||p.fund||' pledge installment due '||i.due_on||'.',
    i.amount_cents-i.paid_cents,${owner},date(i.due_on,'+1 day'),?,0 ${current} AND i.id=? AND ${owner} IS NOT NULL`, taskId, c.now, day, i.id),
   sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
    SELECT ?,?,?,?,'pledge.overdueTask','task',id,donor_id,? FROM cf_call_tasks WHERE id=?`,
    c.now, c.actor.id, c.actor.name, c.actor.role, JSON.stringify({ installmentId: i.id }), taskId),
  ])
 }
}
