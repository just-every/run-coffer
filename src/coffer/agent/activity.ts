import { all, commit, event, newId, sql, type Context } from '../db'
export type Action = {kind:string;subjectId:string;summary:string;why:string;undoKind?:string;undoData?:unknown}
export function activityStatement(c:Context, a:Action, id=newId()) {
 return { id, statement:sql('INSERT INTO cf_agent_activity(id,at,actor_id,actor_name,kind,subject_id,summary,why,undo_kind,undo_data) VALUES(?,?,?,?,?,?,?,?,?,?)',id,c.now,c.actor.id,c.actor.name,a.kind,a.subjectId,a.summary,a.why,a.undoKind??null,a.undoData===undefined?null:JSON.stringify(a.undoData)) }
}
export async function action(c:Context,a:Action) {
 const row=activityStatement(c,a)
 await commit(c,[row.statement,event(c,a.kind,'agent',a.subjectId,null)])
 return row.id
}
export const activity=(c:Context)=>all(c,'SELECT * FROM cf_agent_activity ORDER BY at DESC,id DESC LIMIT 100')
export const systemContext=(db:D1Database,env:Context['env'],at=new Date().toISOString()):Context=>({db,env,now:at,actor:{id:'coffer-agent',name:'Coffer development agent',role:'agent'},authority:{sql:'1',params:[]}})
