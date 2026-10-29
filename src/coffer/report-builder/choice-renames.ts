import { all, guard, sql, type Context, type Stmt } from '../db'

/** Saved selectors follow a renamed choice in the same transaction as values. */
export async function reportChoiceRenames(c:Context,key:string,from:string,to:string):Promise<Stmt[]> {
 const writes:Stmt[]=[]
 for(const report of await all(c,'SELECT id,version,definition FROM cf_saved_reports')){
  const definition=JSON.parse(report.definition)
  let changed=false
  for(const filter of definition.filters??[]){
   if(filter.field==='custom.'+key&&String(filter.value)===from){filter.value=typeof filter.value==='number'?Number(to):to;changed=true}
  }
  if(!changed)continue
  const path='/app/reports/builder?id='+encodeURIComponent(report.id)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_saved_reports WHERE id=? AND version=?)','VERSION','A saved report changed. Review the rename again.',report.id,report.version),
   sql('UPDATE cf_saved_reports SET definition=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(definition),c.now,report.id),
   sql('DELETE FROM cf_report_shares WHERE report_id=?',report.id),
   sql('UPDATE cf_report_recipients SET revoked_at=? WHERE schedule_id IN(SELECT id FROM cf_report_schedules WHERE report_path=?) AND revoked_at IS NULL',c.now,path),
   sql('UPDATE cf_report_schedules SET enabled=0,version=version+1 WHERE report_path=?',path))
 }
 return writes
}
