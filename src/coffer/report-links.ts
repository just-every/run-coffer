import { commit, event, fail, one, type Context } from './db'
import { reportRefusal, reportSystem } from './report-authority'
import { readScheduledReport } from './scheduled-report-selection'

/** A link identifies a selection, never grants access to its contents. */
export async function scheduledReportLink(c:Context,scheduleId:string) {
 const schedule=await one(c,'SELECT * FROM cf_report_schedules WHERE id=?',scheduleId)
 const recipient=await one(c,"SELECT o.id FROM oa_operators o JOIN cf_report_recipients r ON lower(r.recipient)=lower(o.email) WHERE o.id=? AND o.status='active' AND r.schedule_id=? AND r.revoked_at IS NULL",c.actor.id,scheduleId)
 const refusal=schedule?await reportRefusal(c,schedule):'Report unavailable'
 if(!schedule||!recipient||refusal){
  await commit(reportSystem(c),[event(c,'reportSchedule.linkRefused','report_schedule',scheduleId,null,{reason:refusal??'Identity is not an approved recipient'},'cf_access_events')])
  fail('REPORT_FORBIDDEN','This report is unavailable for this identity.',403)
 }
 // Only this approved selection is read with the approving manager's authority.
 const approver=await one(c,'SELECT * FROM oa_operators WHERE id=?',schedule.approved_by)
 const report=await readScheduledReport({...c,actor:{id:approver!.id,name:approver!.display_name,role:approver!.role}},schedule.report_path)
 // Recheck disclosure after generating the report, before returning any contents.
 if(await reportRefusal(c,schedule)){
  await commit(reportSystem(c),[event(c,'reportSchedule.linkRefused','report_schedule',scheduleId,null,{reason:'Authority changed during read'},'cf_access_events')])
  fail('REPORT_FORBIDDEN','This report is unavailable for this identity.',403)
 }
 await commit(c,[event(c,'reportSchedule.linkRead','report_schedule',scheduleId,null,{},'cf_access_events')])
 return report
}
