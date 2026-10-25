import type { Bindings } from '../auth.server'
import { all, commit, CofferError, event, guard, newId, one, sql, type Context } from './db'
import { donorMailUnavailable, sendDonorMail, DonorMailError } from './outbound-mail'
import { nextReportAt } from './report-schedules'
import { readScheduledReport } from './scheduled-report-selection'

/** Explicit human approval authorizes these recipients; current authority is required on every tick. */
export async function runScheduledReports(env:Bindings,at:Date) {
 const now=at.toISOString(),system:Context={db:env.DB,env,now,actor:{id:'report-scheduler',name:'Report scheduler',role:'owner'},authority:{sql:'1=1',params:[]}}
 await commit(system,[sql("UPDATE cf_report_runs SET status='uncertain',detail='Submission interrupted; check provider before any resend.' WHERE status='sending' AND attempted_at<=?",new Date(at.getTime()-15*60_000).toISOString())])
 if(donorMailUnavailable(env)||env.MAIL_PROVIDER==='rer')return
 const due=await all(system,'SELECT * FROM cf_report_schedules WHERE enabled=1 AND next_at<=? ORDER BY next_at,id LIMIT 8',now)
 for(const schedule of due){
  const approver=await one(system,"SELECT * FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin')",schedule.approved_by,schedule.approver_version)
  if(!approver){await commit(system,[sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE id=? AND version=?',schedule.id,schedule.version),event(system,'reportSchedule.held','report_schedule',schedule.id,null,{reason:'approver authority changed'})]);continue}
  const c:Context={...system,actor:{id:approver.id,name:approver.display_name,role:approver.role},authority:{sql:"EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin'))",params:[approver.id,approver.version]}}
  let report:Awaited<ReturnType<typeof readScheduledReport>>
  try{report=await readScheduledReport(c,schedule.report_path)}catch{
   await commit(system,[sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE id=? AND version=?',schedule.id,schedule.version),event(system,'reportSchedule.held','report_schedule',schedule.id,null,{reason:'report selection unavailable'})]);continue
  }
  const bytes=new TextEncoder().encode(JSON.stringify(report,null,2))
  // Refuse explicitly instead of silently truncating a report attachment.
  if(bytes.length>5*1024*1024){await commit(c,[sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE id=? AND version=?',schedule.id,schedule.version),event(c,'reportSchedule.held','report_schedule',schedule.id,null,{reason:'attachment too large'})]);continue}
  const recipients:string[]=JSON.parse(schedule.recipients),attempts=recipients.map(recipient=>({id:newId(),recipient}))
  let next=nextReportAt(schedule.next_at,schedule.cadence,schedule.anchor_day)
  while(next<=now)next=nextReportAt(next,schedule.cadence,schedule.anchor_day)
  try{await commit(c,[guard('EXISTS(SELECT 1 FROM cf_report_schedules WHERE id=? AND version=? AND enabled=1 AND next_at=?)','REPORT_CLAIM','This report occurrence was already claimed.',schedule.id,schedule.version,schedule.next_at),
   ...attempts.map(a=>sql("INSERT INTO cf_report_runs(id,schedule_id,due_at,recipient,status,attempted_at) VALUES(?,?,?,?,'sending',?)",a.id,schedule.id,schedule.next_at,a.recipient,now)),
   sql('UPDATE cf_report_schedules SET next_at=?,version=version+1 WHERE id=?',next,schedule.id),event(c,'reportSchedule.attempt','report_schedule',schedule.id,null,{recipientCount:recipients.length,dueAt:schedule.next_at})])}catch(error){if(error instanceof CofferError&&['REPORT_CLAIM','SESSION_CHANGED'].includes(error.code))continue;throw error}
  for(const attempt of attempts){
   // A paused schedule or revoked approving account stops even a claimed attempt.
   const current=await one(system,`SELECT s.id FROM cf_report_schedules s JOIN oa_operators o ON o.id=s.approved_by WHERE s.id=? AND s.enabled=1 AND s.version=? AND o.version=s.approver_version AND o.status='active' AND o.role IN ('owner','admin')`,schedule.id,schedule.version+1)
   let status='held',messageId:string|null=null
   if(current){
    try{
     const result=await sendDonorMail(env,{deliveryId:attempt.id,from:env.MAIL_FROM!,to:[attempt.recipient],subject:schedule.name,
      text:`${report.title}\nGenerated ${now}\nOpen this report (sign-in required): ${new URL(schedule.report_path,env.AUTH_ORIGIN).href}\nThe attached JSON report contains the selected report's current figures.`,
      attachments:[{filename:'coffer-report.json',type:'application/json',content:base64(bytes)}],customArgs:{coffer_report_run_id:attempt.id}})
     messageId=result.providerMessageId;status=messageId?'submitted':'uncertain'
    }catch(error){status=error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome)?'rejected':'uncertain'}
   }
   await commit(system,[sql("UPDATE cf_report_runs SET status=?,message_id=? WHERE id=? AND status='sending'",status,messageId,attempt.id),event(c,'reportSchedule.result','report_run',attempt.id,null,{status})])
  }
 }
}
function base64(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
