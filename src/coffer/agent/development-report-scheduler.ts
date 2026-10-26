import { runtimeBindings, type Bindings } from '../../auth.server'
import { commit, CofferError, event, fail, guard, integer, one, sql, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import { reportStaff } from './development-report-sources'
import { draftDevelopmentReport, REPORT_GRANT } from './development-report'

export async function developmentReportSchedule(c:Context) {
 reportStaff(c)
 return one(c,'SELECT * FROM cf_development_report_schedule WHERE id=1')
}
export async function saveDevelopmentReportSchedule(c:Context,p:Row) {
 reportStaff(c)
 const version=integer(Number(p.version),'Schedule version',1),day=integer(Number(p.dayOfMonth),'Monthly preparation day',1,28),enabled=p.enabled===true||p.enabled==='yes'?1:0
 if(enabled&&p.reviewed!=='yes')fail('REPORT_SCHEDULE','Explicitly approve monthly preparation. This never approves sending.',400)
 const operator=await one(c,"SELECT version FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')",c.actor.id)
 if(!operator)fail('FORBIDDEN','A current owner or admin must save the schedule.',403)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_development_report_schedule WHERE id=1 AND version=?)','VERSION','This report preparation schedule changed. Refresh before saving.',version),
  ...(enabled?[guard("EXISTS(SELECT 1 FROM cf_automation_grants WHERE id=? AND enabled=1 AND donor_ids IS NULL) AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND enabled=1)",'REPORT_GRANT','Enable the complete-ledger report drafting grant and the global agent switch first.',REPORT_GRANT)]:[]),
  sql('UPDATE cf_development_report_schedule SET version=version+1,enabled=?,day_of_month=?,approved_by=?,approver_version=?,approved_at=?,hold_reason=NULL WHERE id=1',enabled,day,c.actor.id,operator.version,c.now),
  event(c,'developmentReport.schedule','development_report_schedule','1',null,{enabled,dayOfMonth:day,approvedBy:c.actor.id,preparationOnly:true}),
 ])
 return {id:'1',version:version+1,scheduled:true}
}

/** Each minute may prepare the prior completed organization-calendar month.
 * Durable monthly identity prevents duplicate drafts; this function never sends. */
export async function advanceDevelopmentReports(original:Bindings,at=new Date()) {
 const env=runtimeBindings(original),base={db:env.DB},schedule=await one(base,'SELECT * FROM cf_development_report_schedule WHERE id=1 AND enabled=1')
 if(!schedule)return
 const operator=await one(base,"SELECT * FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin')",schedule.approved_by,schedule.approver_version)
 if(!operator){
  const system:Context={db:env.DB,env,now:at.toISOString(),actor:{id:'development-report-scheduler',name:'Report preparation scheduler',role:'owner'},authority:{sql:'1',params:[]}}
  await commit(system,[sql("UPDATE cf_development_report_schedule SET enabled=0,version=version+1,hold_reason='Approving account authority changed' WHERE id=1 AND version=?",schedule.version),event(system,'developmentReport.scheduleHeld','development_report_schedule','1',null,{reason:'Approving account authority changed',approvedBy:schedule.approved_by})]);return
 }
 const authority={sql:`EXISTS(SELECT 1 FROM cf_development_report_schedule s JOIN oa_operators o ON o.id=s.approved_by
  WHERE s.id=1 AND s.version=? AND s.enabled=1 AND o.id=? AND o.version=? AND o.status='active' AND o.role IN ('owner','admin'))`,params:[schedule.version,operator.id,operator.version]}
 const c:Context={db:env.DB,env,now:at.toISOString(),actor:{id:operator.id,name:operator.display_name,role:operator.role},authority}
 const day=today((await settings(c)).timezone,at)
 if(Number(day.slice(8))<schedule.day_of_month)return
 const month=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-2,1)).toISOString().slice(0,7)
 if(await one(c,'SELECT month FROM cf_development_report_schedule_runs WHERE month=?',month))return
 const grant=await one(c,'SELECT enabled,donor_ids FROM cf_automation_grants WHERE id=?',REPORT_GRANT),control=await one(c,'SELECT enabled FROM cf_agent_grant_control WHERE id=1')
 if(!grant?.enabled||grant.donor_ids!==null||!control?.enabled)return
 try{await draftDevelopmentReport(c,{month},schedule.version)}catch(error){
  if(error instanceof CofferError&&['REPORT_MONTH_CLAIM','DAILY_LIMIT','SESSION_CHANGED','REPORT_GRANT','SOURCES_CHANGED'].includes(error.code))return
  throw error
 }
}
