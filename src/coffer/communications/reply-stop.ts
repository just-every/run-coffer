import { requireRole } from '../auth'
import { commit, event, fail, guard, id, integer, one, sql, text, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import type { Bindings } from '../../auth.server'
import { syncPreferences } from './preferences'

/** Only fresh plain-text lines can request an immediate withdrawal. Quoted history and
 * signatures are retained in the reply, but never interpreted as a request. */
export function stopEvidence(body: string): string | null {
 const fresh: string[] = []
 for (const line of body.split(/\r?\n/)) {
  if (/^\s*(?:On .+wrote:|-{2,}\s*(?:Original Message|Forwarded message)\s*-*|Begin forwarded message:|From:\s|--\s*$)/i.test(line)) break
  if (!/^\s*>/.test(line)) fresh.push(line.trim())
 }
 const request = /^(?:(?:please|kindly)\s+)?(?:(?:remove|take)\s+me\s+(?:from|off)\b|remove\s+me[.!\s]*$|unsubscribe(?:\s+me)?(?:\s+from\b|[.!\s]*$)|stop\s+(?:emailing|e-mailing|contacting|sending\s+(?:me\s+)?(?:emails?|e-mails?|messages?|appeals?))\b|(?:do\s+not|don't)\s+(?:email|e-mail|contact)\s+me\b|i\s+(?:want|wish|would\s+like)\s+to\s+(?:unsubscribe|be\s+removed)\b)/i
 return fresh.find(line => request.test(line))?.slice(0, 1000) ?? null
}

export const currentConsent = "(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)"
const live = `d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
export const stopIsCurrent = `r.stop_donor_id=d.id AND r.stop_email IS d.email AND r.stop_consent_id IS ${currentConsent}`
export const automaticStopIsCurrent = `r.stop_donor_id=d.id AND r.stop_email IS d.email AND r.stop_withdrawal_id IS ${currentConsent}`

/** These statements join the ingress transaction. The immutable message identity
 * and frozen withdrawal ID prevent replay from superseding a later preference. */
export async function automaticStopStatements(db: D1Database, taskId: string, at: string): Promise<D1PreparedStatement[]> {
 const captured = today((await settings({ db })).timezone, new Date(at))
 const fresh = "r.id=? AND r.stop_status='automatic' AND r.stop_withdrawal_id IS NULL AND NOT EXISTS(SELECT 1 FROM cf_interactions i WHERE i.id=r.id)"
 return [
  db.prepare(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
   SELECT r.donor_id,'email','withdrawn','email reply',CASE WHEN r.mailbox_id IS NULL
    THEN substr('Explicit stop reply received '||r.received_at||': '||r.stop_evidence,1,1000)
    ELSE 'Explicit stop received in private mailbox; original evidence retained in private reply '||r.id||'.' END,?,?,
   'Email routing (automatic)' FROM cf_reply_tasks r WHERE ${fresh}`).bind(captured, at, taskId),
  db.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'email-routing','Email routing','system','consent.record','donor',r.donor_id,r.donor_id,
   json_object('channel','email','status','withdrawn','method','email reply','automatic',json('true'),'replyTaskId',r.id)
   FROM cf_reply_tasks r WHERE ${fresh}`).bind(at, taskId),
  db.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'email-routing','Email routing','system','reply.autoWithdraw','reply',r.id,r.donor_id,'{}'
   FROM cf_reply_tasks r WHERE ${fresh}`).bind(at, taskId),
  db.prepare(`UPDATE cf_reply_tasks AS r SET stop_withdrawal_id=(SELECT id FROM cf_consents WHERE donor_id=r.donor_id AND channel='email' ORDER BY id DESC LIMIT 1),
   stop_confirmed_at=?,stop_confirmed_by='Email routing (automatic)' WHERE ${fresh}`).bind(at, taskId),
 ]
}

export async function syncAutomaticStop(env: Bindings, taskId: string, at: string): Promise<void> {
 const predicate = `EXISTS(SELECT 1 FROM cf_reply_tasks r JOIN cf_donors d ON d.id=r.donor_id
  WHERE r.id=? AND r.stop_status='automatic' AND ${live} AND ${automaticStopIsCurrent})`
 const task = await one({ db: env.DB }, `SELECT donor_id FROM cf_reply_tasks WHERE id=? AND ${predicate}`, taskId, taskId)
 if (!task) return
 const c: Context = { db: env.DB, env, now: at, actor: { id: 'email-routing', name: 'Email routing', role: 'owner' }, authority: { sql: predicate, params: [taskId] } }
 try { await syncPreferences(c, [task.donor_id]) } catch (error) {
  // Another preference can supersede this withdrawal during provider I/O. Its
  // own sync owns the new answer; never write a pending state over that answer.
  if (await one(c, `SELECT 1 AS current WHERE ${predicate}`, taskId)) throw error
 }
}

export async function replyStopCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['reply.proposeStop', 'reply.confirmStop', 'reply.reverseStop'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'record email consent')
 const taskId = id(p.taskId, 'Reply task'), version = integer(p.stopVersion, 'Stop proposal version', 0)
 const task = await one(c, `SELECT r.*,d.email,${currentConsent} AS current_consent_id FROM cf_reply_tasks r
  JOIN cf_donors d ON d.id=r.donor_id WHERE r.id=? AND ${live}`, taskId)
 if (!task) fail('NOT_FOUND', 'That reply no longer belongs to a current donor.', 404)
 if(task.mailbox_id&&!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only owners and admins review private mailbox replies.',403)
 if (task.automatic) fail('AUTOMATIC_REPLY', 'An automatic reply cannot propose a consent withdrawal.')
 if (command === 'reply.reverseStop') {
  const reason = text(p.reason, 'Why the explicit request was misread', 1000)
  const captured = today((await settings(c)).timezone, new Date(c.now))
  await commit(c, [guard(`EXISTS(SELECT 1 FROM cf_reply_tasks r JOIN cf_donors d ON d.id=r.donor_id WHERE r.id=?
   AND r.automatic=0 AND r.stop_status='automatic' AND r.stop_version=? AND ${live} AND ${automaticStopIsCurrent})`,
   'STOP_CHANGED', 'The automatic withdrawal is no longer the current consent. Review the donor record; this reply cannot reverse a newer preference.', taskId, version),
   sql(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
    SELECT r.donor_id,'email',COALESCE((SELECT status FROM cf_consents WHERE id=r.stop_consent_id AND donor_id=r.donor_id),'withdrawn'),
    'other',CASE WHEN r.mailbox_id IS NULL THEN substr('Misread explicit stop reply '||r.received_at||': '||?,1,1000)
     ELSE 'Misread private mailbox stop reversed; reason retained in private reply '||r.id||'.' END,?,?,? FROM cf_reply_tasks r WHERE r.id=?`, reason, captured, c.now, c.actor.name, taskId),
   sql("UPDATE cf_reply_tasks SET stop_status='reversed',stop_version=stop_version+1,stop_reversed_at=?,stop_reversed_by=?,stop_reversal_reason=? WHERE id=?", c.now, c.actor.name, reason, taskId),
   event(c, 'consent.record', 'donor', task.donor_id, task.donor_id, { channel: 'email', method: 'other', replyTaskId: taskId, reversal: true }),
   event(c, command, 'reply', taskId, task.donor_id, { withdrawalConsentId: task.stop_withdrawal_id })])
 } else if (command === 'reply.proposeStop') {
  // Staff interpretation is explicit; preserve the received excerpt as evidence,
  // rather than accepting replacement donor words from the request.
  const evidence = task.body.trim().slice(0, 1000)
  if (!evidence) fail('NO_REPLY_EVIDENCE', 'This reply has no saved plain-text evidence. Record consent on the donor page with the original message.')
  await commit(c, [guard(`EXISTS(SELECT 1 FROM cf_reply_tasks r JOIN cf_donors d ON d.id=r.donor_id WHERE r.id=?
   AND r.automatic=0 AND r.stop_version=? AND COALESCE(r.stop_status,'') IN ('','proposed') AND ${live}
   AND d.email IS ? AND ${currentConsent} IS ?)`, 'REPLY_CHANGED', 'This reply or consent changed. Refresh before proposing a withdrawal.', taskId, version, task.email, task.current_consent_id),
   sql(`UPDATE cf_reply_tasks SET stop_status='proposed',stop_version=stop_version+1,stop_evidence=?,stop_consent_id=?,stop_email=?,stop_donor_id=donor_id,
    stop_proposed_at=?,stop_proposed_by=? WHERE id=?`, evidence, task.current_consent_id, task.email, c.now, c.actor.name, taskId),
   event(c, command, 'reply', taskId, task.donor_id, { communicationId: task.communication_id })])
 } else {
  const captured = today((await settings(c)).timezone, new Date(c.now))
  await commit(c, [guard(`EXISTS(SELECT 1 FROM cf_reply_tasks r JOIN cf_donors d ON d.id=r.donor_id WHERE r.id=?
   AND r.automatic=0 AND r.stop_status='proposed' AND r.stop_version=? AND ${live} AND ${stopIsCurrent})`,
   'STOP_CHANGED', 'This proposal, donor email or consent changed. Refresh and review the reply before confirming.', taskId, version),
   // Consent history is shared with staff and donor files; mailbox text stays
   // in the private reply, linked by its opaque ID rather than copied here.
   sql(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
    SELECT donor_id,'email','withdrawn','email reply',CASE WHEN mailbox_id IS NULL
     THEN substr('Reply received '||received_at||': '||stop_evidence,1,1000)
     ELSE 'Private mailbox stop confirmed; original evidence retained in private reply '||id||'.' END,?,?,?
    FROM cf_reply_tasks WHERE id=?`, captured, c.now, c.actor.name, taskId),
   sql("UPDATE cf_reply_tasks SET stop_status='confirmed',stop_version=stop_version+1,stop_confirmed_at=?,stop_confirmed_by=? WHERE id=?", c.now, c.actor.name, taskId),
   sql("UPDATE cf_interactions SET next_step=COALESCE(next_step||' ','')||? WHERE id=?", `Email consent withdrawal confirmed by ${c.actor.name}.`, taskId),
   event(c, 'consent.record', 'donor', task.donor_id, task.donor_id, { channel: 'email', status: 'withdrawn', method: 'email reply', replyTaskId: taskId }),
   event(c, command, 'reply', taskId, task.donor_id, { communicationId: task.communication_id })])
 }
 return (await one(c, 'SELECT * FROM cf_reply_tasks WHERE id=?', taskId))!
}
