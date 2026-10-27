import { requireRole } from './auth'
import { all, commit, date, event, fail, guard, id, newId, one, optional, sql, today, type Context, type Row, type Stmt } from './db'
import { routingOwner } from './relationship-owner'
import { settings } from './settings'

/** Every send and print path admits only active constituents (DONOR-012). */
export const ACTIVE = `constituent_status='active'`
export const STATUSES = ['active', 'inactive', 'deceased'] as const
export const EXCLUDED_REASONS = ['deceased', 'inactive'] as const
export const countReason = (counts: Record<string, number>, status: string) => { counts[status] = (counts[status] ?? 0) + 1 }

/** Validates a profile's status fields and builds every consequence of a change in one list. */
export async function statusChange(c: Context, donor: Row, p: Row, status: string) {
 const changed = status !== donor.constituent_status
 const timezone = (await settings(c)).timezone
 let reason: string | null = donor.status_reason ?? null, on: string | null = donor.deceased_on ?? null
 if (p.statusReason !== undefined) reason = optional(p.statusReason, 'Status reason', 500)
 if (p.deceasedOn !== undefined) on = p.deceasedOn === null || p.deceasedOn === '' ? null : date(p.deceasedOn, 'Date of death')
 if (status === 'active') { reason = null; on = null }
 if (status === 'inactive') { on = null; if (changed && !reason) fail('INPUT', 'Record why this constituent is inactive, for example asked for no contact, moved away or no longer engaged.', 400) }
 if (status === 'deceased') {
  if (changed && !on) fail('INPUT', 'Record the date of death.', 400)
  if (on && on > today(timezone, new Date(c.now))) fail('INPUT', 'The date of death cannot be in the future.', 400)
 }
 const columns = { status_reason: reason, deceased_on: on, status_changed_at: changed ? c.now : donor.status_changed_at ?? null, status_changed_by: changed ? c.actor.name : donor.status_changed_by ?? null }
 const detail = { from: donor.constituent_status, to: status, reason, deceasedOn: on, recordedBy: c.actor.name }
 if (!changed) return { columns, statements: [] as Stmt[], after: [] as Stmt[], changed, detail }
 const statements: Stmt[] = [], after: Stmt[] = []
 if (status !== 'active') {
  const [calls, repeating, journey, owner] = await Promise.all([
   one(c, "SELECT count(*) AS n FROM cf_call_tasks WHERE donor_id=? AND status IN ('open','snoozed')", donor.id),
   one(c, "SELECT count(*) AS n FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE s.donor_id=? AND t.status='open'", donor.id),
   one(c, "SELECT (SELECT count(*) FROM cf_welcome_enrollments WHERE donor_id=? AND status='active')+(SELECT count(*) FROM cf_journey_enrollments WHERE donor_id=? AND status='active') AS n", donor.id,donor.id),
   routingOwner(c.db, donor.id)])
  const closed = { callTasks: calls!.n, repeatingTasks: repeating!.n, journeys: journey!.n }
  Object.assign(detail, { closed })
  const note = `Closed: constituent marked ${status}.`
  after.push(
   sql("UPDATE cf_call_tasks SET status='done',completed_at=?,closed_reason=?,version=version+1 WHERE donor_id=? AND status IN ('open','snoozed')", c.now, status, donor.id),
   sql("UPDATE cf_recurring_tasks SET status='done',completed_at=?,completed_by=?,notes=?,version=version+1 WHERE status='open' AND series_id IN (SELECT id FROM cf_recurring_task_series WHERE donor_id=?)", c.now, c.actor.name, note, donor.id),
   sql("UPDATE cf_welcome_enrollments SET status=?,stopped_at=? WHERE donor_id=? AND status='active'", status, c.now, donor.id),
   sql("UPDATE cf_welcome_steps SET status='cancelled',note=? WHERE donor_id=? AND status='pending'", `The donor was marked ${status}. No email was sent.`, donor.id))
  if (owner) after.push(sql('INSERT INTO cf_status_notices(id,donor_id,owner_id,status,detail,created_at) VALUES(?,?,?,?,?,?)', newId(), donor.id, owner.id, status,
   JSON.stringify({ closed, deceasedOn: on, reason, recordedBy: c.actor.name }), c.now))
 }
 // A deceased member (or one restored) changes the computed household names; a person confirms them before the next mailing.
 if (donor.household_id && (status === 'deceased' || donor.constituent_status === 'deceased')) after.push(sql('UPDATE cf_households SET survivor_review=1 WHERE id=?', donor.household_id))
 after.push(event(c, 'donor.status', 'donor', donor.id, donor.id, detail))
 return { columns, statements, after, changed, detail }
}

/** In-app notices for the relationship manager; nothing is emailed. */
export async function statusNotices(c: Context) {
 const boss = c.actor.role === 'owner' || c.actor.role === 'admin'
 const rows = await all(c, `SELECT n.*,d.name AS donor_name,o.display_name AS owner_name FROM cf_status_notices n JOIN cf_donors d ON d.id=n.donor_id AND d.erased_at IS NULL
  LEFT JOIN oa_operators o ON o.id=n.owner_id WHERE n.acknowledged_at IS NULL AND (?=1 OR n.owner_id=?) ORDER BY n.created_at DESC,n.id LIMIT 100`, boss ? 1 : 0, c.actor.id)
 return rows.map((r): Row => ({ ...r, detail: JSON.parse(r.detail) }))
}

export async function statusCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'statusNotice.acknowledge') return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'acknowledge status notices')
 const noticeId = id(p.noticeId, 'Notice'), boss = c.actor.role === 'owner' || c.actor.role === 'admin'
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_status_notices WHERE id=? AND acknowledged_at IS NULL AND (?=1 OR owner_id=?))', 'NOTICE_CHANGED', 'This notice was already acknowledged, or it is addressed to another person.', noticeId, boss ? 1 : 0, c.actor.id),
  sql('UPDATE cf_status_notices SET acknowledged_at=?,acknowledged_by=? WHERE id=?', c.now, c.actor.name, noticeId), event(c, command, 'notice', noticeId, null)])
 return { id: noticeId, acknowledged: true }
}
