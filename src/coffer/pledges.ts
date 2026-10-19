import type { Bindings } from '../auth.server'
import { sendSendGrid, SendGridSendError } from '../modules/mail/src/sendgrid-email/index.mjs'
import { requireRole } from './auth'
import { addDays, all, commit, date, event, fail, guard, id, integer, newId, object, one, optional, sql, today, type Context, type Row, type Stmt } from './db'
import { amount, usd } from './money'
import { longDate, settings } from './settings'

/** User-facing availability is also the preflight: suppressed mail is never sent. */
export function pledgeMailUnavailable(env?: Bindings): string | null {
 if (!env || env.RER_INSTALLATION_ID || env.RER_MANAGEMENT_ORIGIN) return 'Email sending is not available yet on RER Managed.'
 if (env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1' || env.MAIL_PROVIDER === 'development') return 'Reminder email is suppressed in local and demo mode. No email is sent.'
 if (env.MAIL_PROVIDER !== 'sendgrid' || !env.MAIL_API_KEY?.trim() || !env.MAIL_FROM?.trim()) return 'Configure SendGrid and a sender address to send pledge reminders.'
 return null
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
 if (!['pledge.create', 'pledge.remind', 'pledge.match'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'manage pledges')
 if (command === 'pledge.create') {
  const donorId = id(p.donorId, 'Donor'), pledgeId = newId(), cents = amount(p, 'amount', 'Pledge amount')
  const pledgedOn = date(p.pledgedOn, 'Pledged on'), fund = optional(p.fund, 'Fund', 100) ?? 'Unrestricted'
  const installments = schedule(p, pledgedOn)
  if (installments.reduce((n, row) => n + row.cents, 0) !== cents) fail('INPUT', 'The installment amounts must add up to the pledge amount.', 400)
  await commit(c, [guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)', 'NOT_FOUND', 'That donor does not exist.', donorId),
   sql('INSERT INTO cf_pledges(id,donor_id,amount_cents,pledged_on,due_by,fund,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)', pledgeId, donorId, cents, pledgedOn, installments.at(-1)!.dueOn, fund, c.now, c.actor.name),
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
   AND (SELECT COALESCE(SUM(amount_cents),0) FROM cf_contribution_ledger WHERE pledge_id=p.id)<=p.amount_cents)`, 'PLEDGE', 'Choose an installment for this pledge and use its donor and fund.', giftId, pledgeId, donorId)]
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
 const [pledges, installments] = await Promise.all([
  all(c, `SELECT p.*,COALESCE((SELECT SUM(g.amount_cents - CASE WHEN g.kind='reversal' THEN -1 ELSE 1 END *
   COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_allocations a WHERE a.gift_id=COALESCE(g.reverses,g.id)),0))
   FROM cf_contribution_ledger g WHERE g.pledge_id=p.id),0) AS legacy_paid_cents FROM cf_pledges p WHERE p.donor_id=? ORDER BY p.pledged_on DESC,p.id`, donorId),
  all(c, 'SELECT i.* FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id WHERE p.donor_id=? ORDER BY i.position', donorId),
 ])
 return pledges.map(p => {
  const rows: Row[] = installments.filter(i => i.pledge_id === p.id).map(i => ({ ...i, remaining_cents: i.amount_cents - i.paid_cents }))
  const paid = p.legacy_paid_cents + rows.reduce((n, i) => n + i.paid_cents, 0)
  return { ...p, paid_cents: paid, remaining_cents: Math.max(0, p.amount_cents - paid), installments: rows }
 })
}

const eligible = `(SELECT status FROM cf_consents k WHERE k.donor_id=d.id AND k.channel='email' ORDER BY k.id DESC LIMIT 1)='granted'
 AND d.erased_at IS NULL AND d.email IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM cf_acks bad WHERE bad.donor_id=d.id AND bad.recipient_email=d.email AND bad.delivery_status IN ('bounced','complained'))`

async function remind(c: Context, p: Row): Promise<Row> {
 const unavailable = pledgeMailUnavailable(c.env)
 if (unavailable) fail('mail_unavailable', unavailable, 503)
 const donorId = optional(p.donorId, 'Donor', 100), pledgeId = optional(p.pledgeId, 'Pledge', 100)
 const s = await settings(c), day = today(s.timezone, new Date(c.now))
 // A terminated Worker may have submitted its claimed email. Never reclaim it.
 await commit(c, [sql("UPDATE cf_pledge_installments SET reminder_status='uncertain',reminder_note='Submission was interrupted. Check SendGrid before contacting the donor. No automatic resend.' WHERE reminder_status='sending' AND attempt_started_at<=?", new Date(Date.parse(c.now) - 15 * 60_000).toISOString())])
 const due = await all(c, `SELECT i.id FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id
  JOIN cf_donors d ON d.id=p.donor_id WHERE i.reminder_status='pending' AND i.remind_on<=? AND i.paid_cents<i.amount_cents
  AND (? IS NULL OR p.donor_id=?) AND (? IS NULL OR p.id=?) AND ${eligible} ORDER BY i.remind_on,i.id LIMIT 8`, day, donorId, donorId, pledgeId, pledgeId)
 let submitted = 0, uncertain = 0, rejected = 0
 for (const row of due) {
  const attempt = newId()
  await commit(c, [sql(`UPDATE cf_pledge_installments SET reminder_status='sending',attempt_id=?,attempt_started_at=?,recipient_email=(SELECT d.email FROM cf_pledges p JOIN cf_donors d ON d.id=p.donor_id WHERE p.id=pledge_id)
   WHERE id=? AND reminder_status='pending' AND EXISTS(SELECT 1 FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
   WHERE i.id=cf_pledge_installments.id AND i.remind_on<=? AND i.paid_cents<i.amount_cents AND ${eligible})`, attempt, c.now, row.id, day)])
  const i = await one(c, `SELECT i.*,p.donor_id,p.fund,d.name,d.email FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id WHERE i.id=? AND i.attempt_id=? AND i.reminder_status='sending' AND ${eligible}`, row.id, attempt)
  if (!i || i.paid_cents >= i.amount_cents || i.email !== i.recipient_email) {
   await c.db.prepare("UPDATE cf_pledge_installments SET reminder_status='skipped',recipient_email=NULL,reminder_note='The balance or recipient changed before submission. No email was sent.' WHERE id=? AND attempt_id=? AND reminder_status='sending'").bind(row.id, attempt).run()
   continue
  }
  let state: string = 'uncertain', messageId: string | null = null
  try {
   const sent = await sendSendGrid({ apiKey: c.env!.MAIL_API_KEY!, message: { deliveryId: attempt, from: c.env!.MAIL_FROM!, to: [i.recipient_email],
    subject: `Pledge reminder from ${s.organisation || 'your organization'}`,
    text: `Dear ${i.name},\n\nThis is a reminder of your ${usd(i.amount_cents - i.paid_cents)} pledge installment to ${s.organisation || 'our organization'} for ${i.fund}, due ${longDate(i.due_on)}.\n\nIf you have already sent your gift, thank you. Please contact us if your plans have changed.`,
    customArgs: { coffer_installment_id: i.id, coffer_attempt_id: attempt } } })
   messageId = sent.providerMessageId ?? null
   state = messageId ? 'submitted' : 'uncertain'
  } catch (error) {
   if (error instanceof SendGridSendError && ['rejected', 'rate_limited'].includes(error.outcome)) state = 'rejected'
  }
  const note = state === 'submitted' ? 'Accepted by SendGrid; delivery is not confirmed.' : state === 'rejected' ? 'SendGrid did not accept this reminder. No automatic resend.' : 'Email submission could not be confirmed. Check SendGrid before contacting the donor. No automatic resend.'
  // The claim already authorized this submission. Persist its outcome even if
  // that person's session is revoked while SendGrid is answering.
  const outcome = [sql("UPDATE cf_pledge_installments SET reminder_status=?,message_id=?,submitted_at=?,reminder_note=? WHERE id=? AND attempt_id=? AND reminder_status='sending'", state, messageId, c.now, note, i.id, attempt), event(c, 'pledge.reminder', 'pledge', i.pledge_id, i.donor_id, { installmentId: i.id, state })]
  await c.db.batch(outcome.map(s => c.db.prepare(s.sql).bind(...s.params)))
  if (state === 'submitted') submitted++
  else if (state === 'rejected') rejected++
  else uncertain++
 }
 return { submitted, uncertain, rejected }
}

/** Real Worker scheduled handler calls this; failures stay visible to the host.
 * Unavailable installations do no work and never claim an email as submitted. */
export async function runPledgeReminders(env: Bindings, at = new Date()): Promise<Row> {
 const unavailable = pledgeMailUnavailable(env)
 if (unavailable) return { submitted: 0, unavailable }
 return remind({ db: env.DB, env, now: at.toISOString(), actor: { id: 'coffer-scheduler', name: 'Pledge scheduler', role: 'owner' }, authority: { sql: 'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)', params: [] } }, {})
}
