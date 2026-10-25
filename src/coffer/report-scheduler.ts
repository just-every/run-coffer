import type { Bindings } from '../auth.server'
import { all, commit, CofferError, event, guard, newId, one, sql, type Context } from './db'
import { donorMailUnavailable } from './outbound-mail'
import { nextReportAt } from './report-schedules'
import { readScheduledReport } from './scheduled-report-selection'
import { reportRefusal, holdReport } from './report-authority'
import { deliverReport } from './report-delivery'

export async function runScheduledReports(env:Bindings,at:Date) {
 const now=at.toISOString(),system:Context={db:env.DB,env,now,actor:{id:'report-scheduler',name:'Report scheduler',role:'owner'},authority:{sql:'1=1',params:[]}}
 await commit(system,[sql("UPDATE cf_report_runs SET status='uncertain',detail='Delivery unconfirmed. Submission interrupted; check provider before choosing to resend.' WHERE status='sending' AND attempted_at<=?",new Date(at.getTime()-15*60_000).toISOString())])
 if(donorMailUnavailable(env)||env.MAIL_PROVIDER==='rer')return
 const due=await all(system,'SELECT * FROM cf_report_schedules WHERE enabled=1 AND next_at<=? ORDER BY next_at,id LIMIT 8',now)
 for(const schedule of due){
  const refusal=await reportRefusal(system,schedule)
  if(refusal){await holdReport(system,schedule,refusal);continue}
  const approver=await one(system,'SELECT * FROM oa_operators WHERE id=?',schedule.approved_by)
  const c:Context={...system,actor:{id:approver!.id,name:approver!.display_name,role:approver!.role}}
  let report:Awaited<ReturnType<typeof readScheduledReport>>
  try{report=await readScheduledReport(c,schedule.report_path)}catch{await holdReport(c,schedule,'Report selection unavailable');continue}
  const recipients:string[]=JSON.parse(schedule.recipients),attempts=recipients.map(recipient=>({id:newId(),recipient}))
  let next=nextReportAt(schedule.next_at,schedule.cadence,schedule.anchor_day)
  while(next<=now)next=nextReportAt(next,schedule.cadence,schedule.anchor_day)
  try{await commit(system,[guard('EXISTS(SELECT 1 FROM cf_report_schedules WHERE id=? AND version=? AND enabled=1 AND next_at=?)','REPORT_CLAIM','This report occurrence was already claimed.',schedule.id,schedule.version,schedule.next_at),
   ...attempts.map(a=>sql("INSERT INTO cf_report_runs(id,schedule_id,due_at,recipient,status,attempted_at) VALUES(?,?,?,?,'sending',?)",a.id,schedule.id,schedule.next_at,a.recipient,now)),
   sql('UPDATE cf_report_schedules SET next_at=?,version=version+1 WHERE id=?',next,schedule.id),event(c,'reportSchedule.attempt','report_schedule',schedule.id,null,{recipientCount:recipients.length,dueAt:schedule.next_at})])}catch(error){if(error instanceof CofferError&&error.code==='REPORT_CLAIM')continue;throw error}
  for(const attempt of attempts)await deliverReport(c,schedule,attempt,report)
 }
}
