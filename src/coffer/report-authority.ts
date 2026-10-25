import { all, commit, event, newId, one, sql, type Context, type Row } from './db'

export function reportSystem(c:Context):Context {
 return {...c,actor:{id:'report-scheduler',name:'Report scheduler',role:'owner'},authority:{sql:'1=1',params:[]}}
}
/** Check current disclosure approval immediately before each outbound submission. */
export async function reportRefusal(c:Context,schedule:Row,recipient?:string):Promise<string|null> {
 const current=await one(c,'SELECT * FROM cf_report_schedules WHERE id=?',schedule.id)
 if(!current?.enabled)return 'Schedule paused'
 const approver=await one(c,"SELECT id FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin')",current.approved_by,current.approver_version)
 if(!approver)return 'Approver authority changed'
 const approvals=await all(c,'SELECT recipient FROM cf_report_recipients WHERE schedule_id=? AND revoked_at IS NULL',schedule.id)
 const expected:string[]=recipient?[recipient]:JSON.parse(current.recipients)
 if(expected.some(address=>!approvals.some(a=>a.recipient===address)))return 'Recipient approval revoked'
 return null
}
export async function holdReport(c:Context,schedule:Row,reason:string,runId?:string) {
 const system=reportSystem(c)
 await commit(system,[...(runId?[sql("UPDATE cf_report_runs SET status='held',detail=? WHERE id=? AND status='sending'",reason,runId)]:[...JSON.parse(schedule.recipients).map((recipient:string)=>sql("INSERT OR IGNORE INTO cf_report_runs(id,schedule_id,due_at,recipient,status,attempted_at,detail) VALUES(?,?,?,?,'held',?,?)",newId(),schedule.id,schedule.next_at,recipient,c.now,reason)),sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE id=? AND enabled=1',schedule.id)]),event(c,'reportSchedule.held',runId?'report_run':'report_schedule',runId??schedule.id,null,{reason,scheduleId:schedule.id,approvedBy:schedule.approved_by})])
}
