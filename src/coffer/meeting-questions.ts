import { requireRole } from './auth'
import { choice, commit, event, fail, guard, id, integer, one, sql, type Context, type Row } from './db'

/** Question state stays on the original interaction, including across merge/undo. */
export async function meetingQuestionCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'meeting.question.set') return undefined
 requireRole(c.actor, ['owner','admin','member'], 'update meeting questions')
 const key=id(p.interactionId,'Meeting interaction'), version=integer(Number(p.version),'Question version',1)
 const state=choice(p.state,['open','resolved'] as const,'question state')
 const source=await one(c,`SELECT i.* FROM cf_interactions i JOIN cf_donors d ON d.id=i.donor_id
 WHERE i.id=? AND i.kind='meeting' AND i.open_question IS NOT NULL AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`,key)
 if(!source)fail('NOT_FOUND','That meeting question does not exist.',404)
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_interactions i JOIN cf_donors d ON d.id=i.donor_id
 WHERE i.id=? AND i.donor_id=? AND i.question_version=? AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,
 'VERSION','This question changed. Refresh before saving.',key,source.donor_id,version),
 sql('UPDATE cf_interactions SET question_resolved_at=?,question_version=question_version+1 WHERE id=?',state==='resolved'?c.now:null,key),
 event(c,command,'interaction',key,source.donor_id,{state,version:version+1})])
 return {id:key,donorId:source.donor_id,state,version:version+1}
}
