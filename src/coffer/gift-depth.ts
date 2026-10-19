import { all, choice, commit, date, email, event, fail, guard, id, newId, one, optional, sql, text, today, type Context, type Row } from './db'
import { amount } from './money'
import { settings } from './settings'

const ACTIVE = `g.net_cents>0 AND g.kind='gift' AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)`
const giftGuard = (giftId: string) => guard(`EXISTS(SELECT 1 FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND ${ACTIVE})`, 'GIFT_CHANGED', 'Choose a gift from a live donor that has not been reversed.', giftId)
const donorGuard = (donorId: string) => guard('EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))', 'NOT_FOUND', 'Choose a donor who has not been erased or merged.', donorId)

/** Attribution commands never write cf_gifts: recognition is not cash received. */
export async function giftDepthCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'softCredit.record') {
  const giftId = id(p.giftId, 'Gift'), donorId = id(p.donorId, 'Credited donor'), creditId = newId(), cents = amount(p, 'amount', 'Recognition amount')
  await commit(c, [giftGuard(giftId), donorGuard(donorId),
   guard('EXISTS(SELECT 1 FROM cf_gift_balances WHERE id=? AND donor_id<>? AND net_cents>=?)', 'CREDIT_AMOUNT', 'Credit another donor for no more than the original gift amount.', giftId, donorId, cents),
   guard('NOT EXISTS(SELECT 1 FROM cf_soft_credits WHERE gift_id=? AND donor_id=?)', 'CREDIT_EXISTS', 'This donor already has recognition for that gift. Remove it before recording a correction.', giftId, donorId),
   sql('INSERT INTO cf_soft_credits VALUES(?,?,?,?,?,?)', creditId, giftId, donorId, cents, c.now, c.actor.name),
   event(c, command, 'softCredit', creditId, donorId, { giftId, amountCents: cents })])
  return { id: creditId, donorId, amountCents: cents }
 }
 if (command === 'softCredit.remove') {
  const creditId = id(p.softCreditId, 'Soft credit'), credit = await one(c, 'SELECT * FROM cf_soft_credits WHERE id=?', creditId)
  if (!credit) fail('NOT_FOUND', 'That recognition credit does not exist.', 404)
  await commit(c, [guard('EXISTS(SELECT 1 FROM cf_soft_credits WHERE id=?)', 'NOT_FOUND', 'That recognition credit no longer exists.', creditId),
   sql('DELETE FROM cf_soft_credits WHERE id=?', creditId), event(c, command, 'softCredit', creditId, credit.donor_id, { giftId: credit.gift_id, amountCents: credit.amount_cents })])
  return { id: creditId, donorId: credit.donor_id, removed: true }
 }
 if (command === 'tribute.record') {
  const giftId = id(p.giftId, 'Gift'), kind = choice(p.kind, ['honor', 'memory'] as const, 'tribute type'), honoree = text(p.honoree, 'Honoree')
  const notifiedName = optional(p.notifiedName, 'Notified person name'), notifiedEmail = email(p.notifiedEmail, 'Notified person email'), donorId = optional(p.donorId, 'Honoree donor', 100)
  if (notifiedEmail && !notifiedName) fail('INPUT', 'Enter the notified person’s name with their email.', 400)
  await commit(c, [giftGuard(giftId), ...(donorId ? [donorGuard(donorId)] : []),
   guard(`NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE (a.live=1 OR b.kind='statement') AND b.status<>'discarded' AND (a.gift_id=? OR EXISTS(SELECT 1 FROM json_each(a.statement_gifts) j WHERE json_extract(j.value,'$.id')=?)))`, 'IN_ACKNOWLEDGEMENT', 'A receipt already holds this gift. Discard an unsent batch before changing its tribute.', giftId, giftId),
   sql(`INSERT INTO cf_gift_tributes VALUES(?,1,?,?,?,?,?,?,?) ON CONFLICT(gift_id) DO UPDATE SET version=version+1,kind=excluded.kind,honoree=excluded.honoree,notified_name=excluded.notified_name,notified_email=excluded.notified_email,donor_id=excluded.donor_id,created_at=excluded.created_at,created_by=excluded.created_by`, giftId, kind, honoree, notifiedName, notifiedEmail, donorId, c.now, c.actor.name),
   event(c, command, 'gift', giftId, donorId, { kind })])
  return { giftId }
 }
 if (command === 'match.record') {
  const giftId = id(p.giftId, 'Original gift'), employerId = id(p.employerDonorId, 'Employer donor'), matchId = newId(), cents = amount(p, 'amount', 'Expected match amount'), due = date(p.dueBy, 'Match due date')
  await commit(c, [giftGuard(giftId), donorGuard(employerId),
   guard('EXISTS(SELECT 1 FROM cf_gifts WHERE id=? AND donor_id<>? AND received_on<=?)', 'MATCH_EMPLOYER', 'Choose another donor as the employer and a due date on or after the original gift.', giftId, employerId, due),
   guard('NOT EXISTS(SELECT 1 FROM cf_employer_matches WHERE gift_id=? AND employer_donor_id=?)', 'MATCH_EXISTS', 'That employer already has a match recorded for this gift.', giftId, employerId),
   sql('INSERT INTO cf_employer_matches VALUES(?,?,?,?,?,NULL,?,?)', matchId, giftId, employerId, cents, due, c.now, c.actor.name),
   event(c, command, 'match', matchId, employerId, { giftId, amountCents: cents, dueBy: due })])
  return { id: matchId }
 }
 if (command === 'match.receive') {
  const matchId = id(p.matchId, 'Expected match'), giftId = id(p.giftId, 'Employer gift'), match = await one(c, 'SELECT * FROM cf_employer_matches WHERE id=?', matchId)
  if (!match) fail('NOT_FOUND', 'That expected employer match does not exist.', 404)
  await commit(c, [giftGuard(match.gift_id), giftGuard(giftId),
   guard(`EXISTS(SELECT 1 FROM cf_employer_matches m JOIN cf_gift_balances g ON g.id=? JOIN cf_gifts original ON original.id=m.gift_id WHERE m.id=? AND g.id<>m.gift_id AND g.donor_id=m.employer_donor_id AND g.net_cents>=m.amount_cents AND g.received_on>=original.received_on AND (m.received_gift_id IS NULL OR COALESCE((SELECT net_cents FROM cf_gift_balances WHERE id=m.received_gift_id),0)<m.amount_cents))`, 'MATCH_GIFT', 'Choose an unreversed gift from the expected employer, received on or after the original gift, covering the expected match. An already received match can only be replaced after reversal.', giftId, matchId),
   guard('NOT EXISTS(SELECT 1 FROM cf_employer_matches WHERE received_gift_id=?)', 'MATCH_ALLOCATED', 'That employer gift already fulfills another expected match.', giftId),
   sql('UPDATE cf_employer_matches SET received_gift_id=? WHERE id=?', giftId, matchId),
   event(c, command, 'match', matchId, match.employer_donor_id, { giftId, originalGiftId: match.gift_id })])
  return { id: matchId, giftId, status: 'received' }
 }
 return undefined
}

/** A tribute is frozen into the same body/hash a person reviews and approves. */
export function tributeReceiptText(tribute: Row | null | undefined): string {
 return tribute ? `This gift was made in ${tribute.kind === 'memory' ? 'memory' : 'honor'} of ${tribute.honoree}.` : ''
}

export async function donorGiftDepth(c: { db: D1Database }, donorId: string) {
 const day = today((await settings(c)).timezone)
 const [credits, tributes, matches] = await Promise.all([
  all(c, `SELECT s.*,g.donor_id AS gift_donor_id,g.received_on,g.amount_cents AS gift_amount_cents,d.name AS gift_donor_name,credited.name AS credited_donor_name,
    COALESCE(a.status,'not acknowledged') AS acknowledgment_status,COALESCE(a.version,0) AS acknowledgment_version,
    a.acknowledged_on,a.method AS acknowledgment_method,a.reason AS acknowledgment_reason,a.interaction_id,a.note_id,
    COALESCE(i.notes,n.body) AS acknowledgment_content,
    MIN(s.amount_cents,g.net_cents) AS recognized_cents,CASE WHEN ${ACTIVE} AND credited.erased_at IS NULL THEN 1 ELSE 0 END AS active
   FROM cf_soft_credits s JOIN cf_gift_balances g ON g.id=s.gift_id JOIN cf_donors d ON d.id=g.donor_id JOIN cf_donors credited ON credited.id=s.donor_id
   LEFT JOIN cf_soft_credit_acknowledgments a ON a.soft_credit_id=s.id
   LEFT JOIN cf_interactions i ON i.id=a.interaction_id LEFT JOIN cf_donor_notes n ON n.id=a.note_id
   WHERE s.donor_id=? OR g.donor_id=? ORDER BY g.received_on DESC`, donorId, donorId),
  all(c, `SELECT t.*,g.donor_id AS gift_donor_id,g.received_on,g.amount_cents AS gift_amount_cents,CASE WHEN ${ACTIVE} THEN 1 ELSE 0 END AS active
   FROM cf_gift_tributes t JOIN cf_gift_balances g ON g.id=t.gift_id JOIN cf_donors d ON d.id=g.donor_id WHERE g.donor_id=? OR t.donor_id=? ORDER BY g.received_on DESC`, donorId, donorId),
  all(c, `SELECT m.*,g.donor_id AS gift_donor_id,d.name AS gift_donor_name,employer.name AS employer_name,g.received_on,
    actual.net_cents AS received_amount_cents,actual.received_on AS matched_on,
    CASE WHEN NOT (${ACTIVE}) THEN 'reversed'
     WHEN actual.id IS NOT NULL AND employer.erased_at IS NULL AND actual.net_cents>=m.amount_cents THEN 'received'
     WHEN m.due_by<? THEN 'overdue' ELSE 'expected' END AS status,
    CASE WHEN actual.id IS NOT NULL AND actual.net_cents>=m.amount_cents THEN 0 ELSE 1 END AS can_receive
   FROM cf_employer_matches m JOIN cf_gift_balances g ON g.id=m.gift_id JOIN cf_donors d ON d.id=g.donor_id JOIN cf_donors employer ON employer.id=m.employer_donor_id LEFT JOIN cf_gift_balances actual ON actual.id=m.received_gift_id
   WHERE g.donor_id=? OR m.employer_donor_id=? ORDER BY m.due_by,m.id`, day, donorId, donorId),
 ])
 for (const credit of credits) credit.acknowledgment = {
  status: credit.acknowledgment_status, version: credit.acknowledgment_version,
  acknowledgedOn: credit.acknowledged_on, method: credit.acknowledgment_method, reason: credit.acknowledgment_reason,
  link: credit.interaction_id || credit.note_id ? { kind: credit.interaction_id ? 'interaction' : 'note', id: credit.interaction_id || credit.note_id, content: credit.acknowledgment_content } : null,
 }
 const creditedGifts = credits.filter(x => x.donor_id === donorId)
 return { softCredits: credits.filter(x => x.gift_donor_id === donorId), creditedGifts, recognitionCents: creditedGifts.filter(x => x.active).reduce((sum, x) => sum + x.recognized_cents, 0), tributes, matches }
}
