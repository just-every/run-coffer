import { automationContext, claimAutomation } from '../automation-grants'
import { all, commit, email, event, fail, guard, id, integer, newId, one, sha256, sql, text, type Context, type Row } from '../db'
import { developmentReportSources, reportStaff } from './development-report-sources'
export { developmentReportFacts, developmentReportSources } from './development-report-sources'

export const DEVELOPMENT_REPORT_POLICY='The director reviews the exact report and named recipients through a current owner or admin account. Only a person triggers submission. Source changes require a new draft; no submission is automatically retried.'
export const REPORT_GRANT='development_reports'
const sourceClock='(SELECT revision FROM cf_development_report_clock WHERE id=1)'
export const reportHash=(r:Row)=>sha256(JSON.stringify([r.subject,r.introduction,r.notes,r.sources,r.recipients]))
export function reportCurrent(r:Row,status=r.status) {
 return guard('EXISTS(SELECT 1 FROM cf_development_reports WHERE id=? AND version=? AND status=? AND custody_hold IS NULL)','REPORT_CHANGED','This report changed or is held. Refresh before continuing.',r.id,r.version,status)
}
export function reportGrant(r:Row) {
 return guard(`EXISTS(SELECT 1 FROM cf_automation_grants WHERE id=? AND version=? AND enabled=1 AND donor_ids IS NULL)
 AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND version=? AND enabled=1)`,'REPORT_GRANT','The report drafting grant changed or stopped. Prepare a new draft under its current authority.',REPORT_GRANT,r.grant_version,r.control_version)
}
export async function sourceSnapshot(c:Context,month:unknown) {
 const before=await one(c,`SELECT ${sourceClock} AS version`),sources=await developmentReportSources(c,month)
 return {sources:JSON.stringify(sources),check:guard(sourceClock+'=?','SOURCES_CHANGED','Source records changed during preparation. Refresh and prepare again.',before!.version)}
}
export async function reportFresh(c:Context,r:Row) {
 const snapshot=await sourceSnapshot(c,r.month)
 if(snapshot.sources!==r.sources)fail('SOURCES_CHANGED','The source reports changed. Prepare a new monthly draft before approval or submission.')
 return snapshot.check
}
export async function reportRow(c:Context,p:Row) {
 reportStaff(c)
 const r=await one(c,'SELECT * FROM cf_development_reports WHERE id=?',id(p.id,'Report'))
 if(!r)fail('NOT_FOUND','That development report does not exist.',404)
 if(r.version!==integer(Number(p.version),'Report version',1))fail('REPORT_CHANGED','This report changed. Refresh before continuing.')
 return r
}
export async function developmentReports(c:Context,month?:string) {
 reportStaff(c)
 const reports=await all(c,'SELECT * FROM cf_development_reports WHERE (? IS NULL OR month=?) ORDER BY prepared_at DESC,id DESC LIMIT 50',month??null,month??null)
 const deliveries=await all(c,'SELECT * FROM cf_development_report_deliveries ORDER BY attempted_at DESC,id DESC LIMIT 500')
 const approvals=await all(c,'SELECT * FROM cf_development_report_approvals ORDER BY approved_at DESC,id DESC LIMIT 500')
 const grant=await one(c,'SELECT * FROM cf_automation_grants WHERE id=?',REPORT_GRANT)
 const schedule=await one(c,'SELECT * FROM cf_development_report_schedule WHERE id=1')
 return {reports:reports.map(r=>({...r,sourceDocument:JSON.parse(r.sources),directorNotes:JSON.parse(r.notes),recipientAddresses:JSON.parse(r.recipients)})),deliveries,approvals,grant,schedule,policy:DEVELOPMENT_REPORT_POLICY}
}
export async function draftDevelopmentReport(c:Context,p:Row,scheduleVersion?:number) {
 reportStaff(c)
 const agent=await automationContext(c.env!,REPORT_GRANT,c.now)
 if(!agent||agent.automation.donor_ids!==null)fail('REPORT_GRANT','Enable the complete-ledger monthly development report drafting grant first.',403)
 await claimAutomation(agent,'developmentReport.draft')
 const snapshot=await sourceSnapshot(c,p.month),sources=JSON.parse(snapshot.sources),key=newId(),control=await one(c,'SELECT version FROM cf_agent_grant_control WHERE id=1')
 const r={id:key,subject:'Development report — '+sources.month,introduction:'Prepared from the organization’s recorded fundraising reports for director review.',notes:'{}',sources:snapshot.sources,recipients:'[]',grant_version:agent.automation.version,control_version:control!.version}
 const audit={grantId:'automation:'+REPORT_GRANT,grantVersion:agent.automation.version,requestedBy:c.actor.id}
 await commit({...c,authority:{sql:`(${c.authority.sql}) AND (${agent.authority.sql})`,params:[...c.authority.params,...agent.authority.params]}},[
  snapshot.check,reportGrant(r),...(scheduleVersion===undefined?[]:[guard('NOT EXISTS(SELECT 1 FROM cf_development_report_schedule_runs WHERE month=?)','REPORT_MONTH_CLAIM','The monthly report was already prepared.',sources.month)]),sql(`INSERT INTO cf_development_reports(id,month,subject,introduction,notes,sources,content_hash,grant_version,control_version,prepared_by,requested_by,prepared_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,sources.month,r.subject,r.introduction,r.notes,r.sources,await reportHash(r),r.grant_version,r.control_version,agent.actor.id,c.actor.id,c.now,c.now),
  ...sources.donorIds.map((donorId:string)=>sql('INSERT INTO cf_development_report_donors VALUES(?,?)',key,donorId)),
  ...(scheduleVersion===undefined?[]:[sql('INSERT INTO cf_development_report_schedule_runs VALUES(?,?,?,?)',sources.month,key,scheduleVersion,c.now)]),
  event({...c,actor:agent.actor},'developmentReport.draft','development_report',key,null,audit),
 ])
 return {id:key,version:1,status:'draft'}
}
/** Numeric facts stay in cited projections. Director edits are explicitly prose;
 * changing a reported number requires preparing it from its native source. */
function prose(value:unknown,label:string,max:number) {
 if(value===undefined||value==='')return ''
 const result=text(value,label,max)
 if(/[\d$%]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion|percent)\b/i.test(result))fail('REPORT_NUMBERS','Keep numerical claims in the source-linked figures. Director commentary accepts prose only.',400)
 return result
}
function recipientList(value:unknown) {
 const raw=Array.isArray(value)?value:typeof value==='string'?value.split(/[,;\n]+/):[]
 const recipients=[...new Set(raw.filter(v=>String(v).trim()).map(v=>email(v,'Report recipient')))].sort()
 if(!recipients.length||recipients.length>20||recipients.some(v=>!v))fail('INPUT','Choose between one and twenty valid recipient addresses.',400)
 return JSON.stringify(recipients)
}
export async function saveDevelopmentReport(c:Context,p:Row) {
 const r=await reportRow(c,p)
 if(!['draft','approved'].includes(r.status))fail('REPORT_LOCKED','A claimed report cannot be edited or submitted again.')
 const notes=Object.fromEntries(JSON.parse(r.sources).sections.map((s:Row)=>[s.key,prose(p[s.key+'Note'],s.title+' commentary',2000)]))
 const next={...r,subject:text(p.subject,'Report subject',200),introduction:prose(p.introduction,'Director introduction',2000),notes:JSON.stringify(notes),recipients:recipientList(p.recipients)}
 if(next.subject!=='Development report — '+r.month)prose(next.subject,'Report subject',200)
 await commit(c,[reportCurrent(r),reportGrant(r),
  sql(`UPDATE cf_development_reports SET subject=?,introduction=?,notes=?,recipients=?,content_hash=?,status='draft',version=version+1,
   approved_by=NULL,approver_version=NULL,approved_at=NULL,approved_version=NULL,updated_at=? WHERE id=?`,next.subject,next.introduction,next.notes,next.recipients,await reportHash(next),c.now,r.id),
  event(c,'developmentReport.save','development_report',r.id,null,{version:r.version+1,approvalInvalidated:r.status==='approved'}),
 ])
 return {id:r.id,version:r.version+1,status:'draft'}
}
export async function approveDevelopmentReport(c:Context,p:Row) {
 const r=await reportRow(c,p)
 if(r.status!=='draft')fail('REPORT_APPROVAL','Only a saved draft can be approved.')
 if(p.reviewed!=='yes'||p.contentHash!==r.content_hash)fail('REPORT_APPROVAL','Review this exact saved report and explicitly approve disclosure to its named recipients.',400)
 const note=text(p.authorityNote,'Director approval authority',1000)
 if(!JSON.parse(r.recipients).length)fail('REPORT_APPROVAL','Save the named recipients before approving.',400)
 if(await reportHash(r)!==r.content_hash)fail('REPORT_CHANGED','The saved content no longer matches its hash.')
 const fresh=await reportFresh(c,r),operator=await one(c,"SELECT version FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')",c.actor.id)
 if(!operator)fail('FORBIDDEN','A current owner or admin must approve this report.',403)
 await commit(c,[fresh,reportCurrent(r,'draft'),reportGrant(r),
  guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin'))",'REPORT_APPROVAL','The approving account changed.',c.actor.id,operator.version),
  sql('INSERT INTO cf_development_report_approvals VALUES(?,?,?,?,?,?,?,?,?)',newId(),r.id,r.version+1,r.content_hash,r.recipients,c.actor.id,operator.version,note,c.now),
  sql("UPDATE cf_development_reports SET status='approved',version=version+1,approved_by=?,approver_version=?,approved_at=?,approved_version=version+1,updated_at=? WHERE id=?",c.actor.id,operator.version,c.now,c.now,r.id),
  event(c,'developmentReport.approve','development_report',r.id,null,{version:r.version+1,contentHash:r.content_hash,recipients:JSON.parse(r.recipients),explicitDisclosureApproval:true}),
 ])
 return {id:r.id,version:r.version+1,status:'approved',contentHash:r.content_hash}
}
