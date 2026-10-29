import { guard, sql, type Context, type Stmt } from '../db'
import type { Plan } from './plan'

/** Explicitly reviewed past asks affect existing native limits. They never
 * submit a new communication or supply current contact permission. */
export function historicalAskWrites(c:Context,plan:Plan):Stmt[] {
 const rows=plan.effects.filter(e=>e.kind==='callTask'&&e.owned&&e.row.status==='done'&&e.row.is_ask===1).map(e=>({runId:e.nativeId,donorId:e.row.donor_id,channel:String(e.row.source_kind).slice(11),askedOn:e.row.completed_at}))
 if(!rows.length)return []
 return [sql(`INSERT INTO cf_solicitation_asks(kind,run_id,donor_id,channel,asked_on,submitted_at) SELECT 'sky-action',json_extract(value,'$.runId'),json_extract(value,'$.donorId'),json_extract(value,'$.channel'),json_extract(value,'$.askedOn'),? FROM json_each(?)`,c.now,JSON.stringify(rows))]
}
const ownedTasks="SELECT t.* FROM cf_move_in_records r JOIN cf_call_tasks t ON t.id=r.native_id WHERE r.job_id=? AND r.kind='callTask' AND r.owned=1"
const exact="t.status='done' AND t.is_ask=1 AND a.kind='sky-action' AND a.run_id=t.id AND a.donor_id=t.donor_id AND a.channel=substr(t.source_kind,12) AND a.asked_on=t.completed_at AND a.submitted_at=t.created_at"

/** Undo can remove only the exact source facts owned by these unchanged tasks.
 * A later native ask still prevents undo under the ordinary dependency fence. */
export function historicalAskUndoGuards(jobId:string):Stmt[] {
 return [guard(`NOT EXISTS(SELECT 1 FROM (${ownedTasks}) t LEFT JOIN cf_solicitation_asks a ON ${exact} WHERE t.status='done' AND t.is_ask=1 AND a.run_id IS NULL)`,'MOVE_IN_USED','Imported historical ask evidence changed. Nothing was undone.',jobId),
 guard(`NOT EXISTS(SELECT 1 FROM cf_solicitation_asks a WHERE a.kind='sky-action' AND a.run_id IN(SELECT id FROM (${ownedTasks})) AND NOT EXISTS(SELECT 1 FROM (${ownedTasks}) t WHERE ${exact}))`,'MOVE_IN_USED','Imported historical ask evidence changed. Nothing was undone.',jobId,jobId)]
}
export function historicalAskUndoWrites(jobId:string):Stmt[] {
 return [sql(`DELETE FROM cf_solicitation_asks WHERE kind='sky-action' AND run_id IN(SELECT id FROM (${ownedTasks}))`,jobId)]
}
