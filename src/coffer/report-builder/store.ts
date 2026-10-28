import { manager, requireRole } from '../auth'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row } from '../db'
import { definition, type Definition } from './definition'

export const shareSql=`EXISTS(SELECT 1 FROM cf_report_shares s JOIN oa_operators o ON o.id=s.approved_by JOIN oa_operators recipient ON recipient.id=s.operator_id WHERE s.report_id=r.id AND s.operator_id=? AND s.report_version=r.version AND o.status='active' AND o.version=s.approver_version AND o.role IN ('owner','admin') AND recipient.status='active')`
export type SavedReport = Row & {id:string;name:string;version:number;definition:Definition}
export async function savedReports(c:Context):Promise<SavedReport[]> {
 requireRole(c.actor,['owner','admin','member'],'read saved reports')
 const rows=await all(c,`SELECT r.* FROM cf_saved_reports r WHERE ?=1 OR ${shareSql} ORDER BY r.name,r.id`,manager(c.actor)?1:0,c.actor.id)
 return rows.map(r=>({...r,definition:JSON.parse(r.definition)} as SavedReport))
}
export async function savedReport(c:Context,reportId:string):Promise<SavedReport> {
 requireRole(c.actor,['owner','admin','member'],'read saved reports')
 const row=await one(c,`SELECT r.* FROM cf_saved_reports r WHERE r.id=? AND (?=1 OR ${shareSql})`,reportId,manager(c.actor)?1:0,c.actor.id)
 if(!row)fail('NOT_FOUND','This report is unavailable or has not been shared with you.',404)
 return {...row,definition:await definition(c,JSON.parse(row.definition))} as SavedReport
}
export async function builderCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['report.save','report.import','report.share','report.revoke'].includes(command))return
 requireRole(c.actor,['owner','admin'],'manage saved reports')
 if(command==='report.save'||command==='report.import') {
  let input=p.definition
  if(command==='report.import'){
   if(typeof p.document==='string'){try{input=JSON.parse(p.document)}catch{fail('INPUT','Choose a Coffer report JSON definition.',400)}}else input=p.document
   if(input?.format!=='coffer-report')fail('INPUT','Choose a Coffer report JSON definition.',400)
   input=input.definition
  }
  const d=await definition(c,input),name=text(p.name,'Report name',120),reportId=command==='report.save'&&p.reportId?id(p.reportId,'Report'):newId()
  const existing=await one(c,'SELECT version FROM cf_saved_reports WHERE id=?',reportId)
  if(p.reportId&&!existing)fail('NOT_FOUND','This report does not exist.',404)
  const version=existing?integer(Number(p.version),'Report version',1):0
  const path='/app/reports/builder?id='+encodeURIComponent(reportId)
  await commit(c,[...(existing?[
   guard('EXISTS(SELECT 1 FROM cf_saved_reports WHERE id=? AND version=?)','VERSION','This report changed. Refresh before saving.',reportId,version),
   sql('UPDATE cf_saved_reports SET name=?,definition=?,version=version+1,updated_at=? WHERE id=?',name,JSON.stringify(d),c.now,reportId),
   sql('DELETE FROM cf_report_shares WHERE report_id=?',reportId),
   sql('UPDATE cf_report_recipients SET revoked_at=? WHERE schedule_id IN(SELECT id FROM cf_report_schedules WHERE report_path=?) AND revoked_at IS NULL',c.now,path),
   sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE report_path=?',path)
  ]:[sql('INSERT INTO cf_saved_reports VALUES(?,?,?,1,?,?)',reportId,name,JSON.stringify(d),c.actor.id,c.now)]),
   event(c,command,'saved_report',reportId,null,{version:version+1,recordType:d.recordType,sharingCleared:Boolean(existing)})])
  return {id:reportId,version:version+1}
 }
 const reportId=id(p.reportId,'Report'),r=await savedReport(c,reportId),version=integer(Number(p.version),'Report version',1),operatorId=id(p.operatorId,'Member')
 const statements=[guard('EXISTS(SELECT 1 FROM cf_saved_reports WHERE id=? AND version=?)','VERSION','This report changed.',reportId,version)]
 if(command==='report.share') {
  if(p.reviewed!=='yes')fail('INPUT','Confirm disclosure of this report to the chosen member.',400)
  const recipient=await one(c,"SELECT id FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member')",operatorId)
  const approver=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
  if(!recipient||!approver)fail('INPUT','Choose an active native member.',400)
  statements.push(guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",'MEMBER_CHANGED','This member changed.',operatorId),sql('INSERT INTO cf_report_shares VALUES(?,?,?,?,?,?) ON CONFLICT(report_id,operator_id) DO UPDATE SET report_version=excluded.report_version,approved_by=excluded.approved_by,approver_version=excluded.approver_version,approved_at=excluded.approved_at',reportId,operatorId,r.version,c.actor.id,approver.version,c.now))
 }else statements.push(sql('DELETE FROM cf_report_shares WHERE report_id=? AND operator_id=?',reportId,operatorId))
 await commit(c,[...statements,event(c,command,'saved_report',reportId,null,{operatorId,version})])
 return {id:reportId,version:r.version}
}
