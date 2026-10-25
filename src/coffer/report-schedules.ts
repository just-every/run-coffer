import { requireRole } from './auth'
import { all, choice, commit, date, email, event, fail, guard, id, newId, one, sql, text, type Context, type Row } from './db'
import { reportRefusal, holdReport } from './report-authority'
import { deliverReport } from './report-delivery'
import { donorMailUnavailable } from './outbound-mail'
import { availableReports, readScheduledReport, reportSelection } from './scheduled-report-selection'

export async function reportSchedules(c:Context) {
 requireRole(c.actor,['owner','admin'],'manage scheduled reports')
 const [schedules,runs]=await Promise.all([all(c,'SELECT * FROM cf_report_schedules ORDER BY approved_at DESC,id'),all(c,'SELECT r.*,s.name,s.report_path FROM cf_report_runs r JOIN cf_report_schedules s ON s.id=r.schedule_id ORDER BY r.attempted_at DESC,r.id LIMIT 100')])
 for(const schedule of schedules)schedule.approvals=await all(c,'SELECT recipient,revoked_at FROM cf_report_recipients WHERE schedule_id=? ORDER BY recipient',schedule.id)
 return {schedules,runs,available:availableReports,mailIssue:c.env?.MAIL_PROVIDER==='rer'?'Managed mail does not support report attachments. Configure a provider with attachment support.':donorMailUnavailable(c.env)}
}
export async function reportScheduleCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!command.startsWith('reportSchedule.'))return
 requireRole(c.actor,['owner','admin'],'manage scheduled reports')
 if(command==='reportSchedule.revokeRecipient'){
  const scheduleId=id(p.scheduleId,'Schedule'),recipient=email(p.recipient,'Recipient')
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_report_recipients WHERE schedule_id=? AND recipient=? AND revoked_at IS NULL)','REPORT_APPROVAL','This recipient approval is no longer active.',scheduleId,recipient),sql('UPDATE cf_report_recipients SET revoked_at=? WHERE schedule_id=? AND recipient=?',c.now,scheduleId,recipient),event(c,command,'report_schedule',scheduleId,null,{recipient})])
  return {id:scheduleId}
 }
 if(command==='reportSchedule.resend'){
  if(p.reviewed!=='yes')fail('REPORT_CONSENT','Confirm possible duplicate delivery before resending.',400)
  const runId=id(p.runId,'Report run'),run=await one(c,'SELECT * FROM cf_report_runs WHERE id=?',runId)
  if(!run||run.status!=='uncertain')fail('REPORT_RETRY','Only delivery-unconfirmed runs may be manually resent.')
  const schedule=await one(c,'SELECT * FROM cf_report_schedules WHERE id=?',run.schedule_id)
  const refusal=await reportRefusal(c,schedule!,run.recipient)
  if(refusal){await holdReport(c,schedule!,refusal);fail('REPORT_HELD',refusal)}
  if(donorMailUnavailable(c.env)||c.env?.MAIL_PROVIDER==='rer')fail('REPORT_HELD','Mail attachments are unavailable.')
  const report=await readScheduledReport(c,schedule!.report_path),attemptId=newId()
  await commit(c,[guard("EXISTS(SELECT 1 FROM cf_report_runs WHERE id=? AND status='uncertain') AND NOT EXISTS(SELECT 1 FROM cf_report_runs WHERE retry_of=?)",'REPORT_RETRY','This run already has a manual resend.',runId,runId),sql("INSERT INTO cf_report_runs(id,schedule_id,due_at,recipient,status,attempted_at,retry_of) VALUES(?,?,?,?,'sending',?,?)",attemptId,schedule!.id,run.due_at,run.recipient,c.now,runId),event(c,command,'report_run',attemptId,null,{retryOf:runId,recipient:run.recipient,explicitDuplicateApproval:true})])
  await deliverReport(c,schedule!,{id:attemptId,recipient:run.recipient},report)
  return {id:attemptId}
 }
 if(command==='reportSchedule.pause'){
  const scheduleId=id(p.scheduleId,'Schedule'),version=Number(p.version)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_report_schedules WHERE id=? AND version=?)','VERSION','This schedule changed. Refresh before pausing.',scheduleId,version),sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE id=?',scheduleId),event(c,command,'report_schedule',scheduleId,null)])
  return {id:scheduleId}
 }
 if(command!=='reportSchedule.save')return
 if(p.reviewed!=='yes')fail('REPORT_CONSENT','Confirm that these people may receive this report by email.',400)
 const name=text(p.name,'Schedule name',100),selection=reportSelection(text(p.reportPath,'Report link',3000),c.env!.AUTH_ORIGIN)
 const raw=Array.isArray(p.recipients)?p.recipients:text(p.recipients,'Recipients',3000).split(/[,;\n]+/)
 const recipients=[...new Set(raw.map((v:unknown)=>email(v,'Recipient email')))]
 if(!recipients.length||recipients.length>20||recipients.includes(null))fail('INPUT','Choose between one and twenty valid recipient addresses.',400)
 const cadence=choice(p.cadence,['weekly','monthly'] as const,'schedule')
 const starts=text(p.startsAt,'First send',40)
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?$/.test(starts))fail('INPUT','First send must be a UTC date and time.',400)
 date(starts.slice(0,10),'First send date')
 const instant=new Date(starts.endsWith('Z')?starts:starts+'Z')
 if(!Number.isFinite(instant.getTime())||instant.getTime()<=Date.parse(c.now))fail('INPUT','First send must be a future UTC date and time.',400)
 // Validate the actual report and every selected filter before approving outbound work.
 await readScheduledReport(c,selection.path)
 const operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id),scheduleId=newId()
 await commit(c,[sql('INSERT INTO cf_report_schedules(id,name,report_path,recipients,cadence,anchor_day,next_at,approved_by,approver_version,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?)',scheduleId,name,selection.path,JSON.stringify(recipients),cadence,instant.getUTCDate(),instant.toISOString(),c.actor.id,operator!.version,c.now),...recipients.map(recipient=>sql('INSERT INTO cf_report_recipients(schedule_id,recipient,approved_by,approved_at) VALUES(?,?,?,?)',scheduleId,recipient,c.actor.id,c.now)),event(c,command,'report_schedule',scheduleId,null,{cadence,approvedBy:c.actor.id,recipients,explicitDisclosureApproval:true})])
 return {id:scheduleId}
}

/** Monthly schedules clamp short months while retaining their original day. */
export function nextReportAt(value:string,cadence:string,anchor:number) {
 const d=new Date(value)
 if(cadence==='weekly')d.setUTCDate(d.getUTCDate()+7)
 else {d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(anchor,end))}
 return d.toISOString()
}
