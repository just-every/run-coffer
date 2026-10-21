import { requireRole } from './auth'
import { choice, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'

export const SOFT_ACK_METHODS = ['email', 'letter', 'phone call', 'in person', 'handwritten note', 'other'] as const

/** A separate thank-you never acknowledges the sponsor's hard-credit gift. */
export async function softCreditAckCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['softCredit.acknowledge', 'softCredit.resetAcknowledgment', 'softCredit.doNotAcknowledge'].includes(command)) return undefined
 requireRole(c.actor, command === 'softCredit.doNotAcknowledge' ? ['owner', 'admin'] : ['owner', 'admin', 'member'], 'change this soft-credit acknowledgment')
 const creditId = id(p.softCreditId, 'Soft credit'), version = integer(p.version, 'Version', 0)
 const credit = await one(c, `SELECT s.*,g.received_on,COALESCE(a.status,'not acknowledged') AS old_status FROM cf_soft_credits s JOIN cf_gifts g ON g.id=s.gift_id
  JOIN cf_donors d ON d.id=s.donor_id LEFT JOIN cf_soft_credit_acknowledgments a ON a.soft_credit_id=s.id WHERE s.id=? AND d.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`, creditId)
 if (!credit) fail('NOT_FOUND', 'That soft credit no longer exists on a live donor.', 404)
 const status = command === 'softCredit.acknowledge' ? 'acknowledged' : command === 'softCredit.doNotAcknowledge' ? 'do not acknowledge' : 'not acknowledged'
 let acknowledgedOn: string | null = null, method: string | null = null, interactionId: string | null = null, noteId: string | null = null, reason: string | null = null
 const evidence: Stmt[] = []
 if (status === 'acknowledged') {
  acknowledgedOn = date(p.acknowledgedOn, 'Thank-you date')
  method = choice(p.method, SOFT_ACK_METHODS, 'thank-you method')
  if (acknowledgedOn < credit.received_on || acknowledgedOn > today((await settings(c)).timezone, new Date(c.now))) fail('INPUT', 'The thank-you date must be on or after the gift and no later than today.', 400)
  interactionId = optional(p.interactionId, 'Linked conversation', 100)
  if (interactionId) {
   if (optional(p.notes, 'Thank-you message', 8000)) fail('INPUT', 'Choose a recorded conversation or enter the thank-you message.', 400)
   const kind = method === 'email' ? 'email' : method === 'phone call' ? 'call' : method === 'in person' ? 'meeting' : null
   if (!kind) fail('INPUT', 'For this method, record the thank-you message rather than linking a call, meeting or email.', 400)
   evidence.push(guard('EXISTS(SELECT 1 FROM cf_interactions WHERE id=? AND donor_id=? AND occurred_on=? AND kind=?)', 'ACK_INTERACTION', 'Choose a conversation with the credited donor on the thank-you date and using the same method.', interactionId, credit.donor_id, acknowledgedOn, kind))
  } else {
   const body = longText(p.notes, 'Thank-you message or interaction notes')
   noteId = newId()
   evidence.push(sql('INSERT INTO cf_donor_notes(id,donor_id,occurred_on,body,source,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?)', noteId, credit.donor_id, acknowledgedOn, body, `Coffer soft-credit thank-you (${method})`, c.now, c.actor.name))
  }
 } else if (status === 'do not acknowledge') reason = text(p.reason, 'Reason not to acknowledge', 1000)
 await commit(c, [
  guard(`EXISTS(SELECT 1 FROM cf_soft_credits s JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=? AND s.donor_id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, 'CREDIT_CHANGED', 'The credited donor changed. Refresh before saving.', creditId, credit.donor_id),
  guard('COALESCE((SELECT version FROM cf_soft_credit_acknowledgments WHERE soft_credit_id=?),0)=?', 'VERSION', 'This acknowledgment changed. Refresh before saving.', creditId, version),
  ...evidence,
  sql(`INSERT INTO cf_soft_credit_acknowledgments(soft_credit_id,version,status,acknowledged_on,method,interaction_id,note_id,reason,updated_at,updated_by)
   VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(soft_credit_id) DO UPDATE SET version=excluded.version,status=excluded.status,acknowledged_on=excluded.acknowledged_on,method=excluded.method,interaction_id=excluded.interaction_id,note_id=excluded.note_id,reason=excluded.reason,updated_at=excluded.updated_at,updated_by=excluded.updated_by`, creditId, version + 1, status, acknowledgedOn, method, interactionId, noteId, reason, c.now, c.actor.name),
  event(c, command, 'softCredit', creditId, credit.donor_id, { oldStatus:credit.old_status, source:'manual', status, acknowledgedOn, method, interactionId, noteId, version: version + 1 }),
 ])
 return { id: creditId, donorId: credit.donor_id, version: version + 1, status, acknowledgedOn, method, interactionId, noteId, reason }
}
