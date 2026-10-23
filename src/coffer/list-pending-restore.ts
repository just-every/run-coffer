import { requireRole } from './auth'
import { all, commit, event, fail, guard, id, integer, one, sql, type Context, type Row, type Stmt } from './db'
import { snapshot, stateGuard, updateRow } from './list-profile-bulk'

/** Undo restores profiles. Resuming earlier work needs its own audited decision. */
export async function restorePendingCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='list.restorePending')return
 requireRole(c.actor,['owner','admin'],'restore earlier pending work')
 if(p.confirm!=='yes')fail('CONSENT','Explicitly confirm restoring earlier tasks and unsent journey steps.',400)
 const jobId=id(p.jobId,'Bulk action'),version=integer(Number(p.version),'Action version',1),job=await one(c,"SELECT * FROM cf_list_bulk_jobs WHERE id=? AND kind='status'",jobId)
 if(!job?.undone_at||job.pending_restored_at||job.version!==version)fail('VERSION','Choose a status action whose records were restored and whose pending work has not been restored.',409)
 const rows=await all(c,'SELECT * FROM cf_list_bulk_rows WHERE job_id=? ORDER BY donor_id',jobId),writes:Stmt[]=[]
 if(!rows.length)fail('NOT_FOUND','No records remain to restore.',404)
 for(const row of rows){
  const before=JSON.parse(row.before_state),after=JSON.parse(row.after_state),live=await snapshot(c,row.donor_id)
  for(const key of ['calls','series','enrollments','steps'] as const)if(JSON.stringify(live[key])!==JSON.stringify(after[key]))fail('BULK_CHANGED','A task or journey changed after undo. No pending work was restored.',409)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','BULK_CHANGED','The constituent changed after undo. No pending work was restored.',row.donor_id,row.donor_version,row.donor_id),stateGuard(row.donor_id,live))
  for(const [table,values,keys] of [['cf_call_tasks',before.calls,['id']],['cf_recurring_tasks',before.series,['id']],['cf_welcome_enrollments',before.enrollments,['donor_id']],['cf_welcome_steps',before.steps,['id']]] as [string,Row[],string[]][])for(const value of values)writes.push(updateRow(table,value,keys))
  writes.push(sql('UPDATE cf_donors SET version=version+1 WHERE id=?',row.donor_id),event(c,command,'donor',row.donor_id,row.donor_id,{jobId}))
 }
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_list_bulk_jobs WHERE id=? AND version=? AND kind='status' AND undone_at IS NOT NULL AND pending_restored_at IS NULL)",'VERSION','This action changed.',jobId,version),...writes,sql('UPDATE cf_list_bulk_jobs SET version=version+1,pending_restored_at=? WHERE id=?',c.now,jobId),event(c,command,'list_bulk',jobId,null,{count:rows.length,confirmed:true})])
 return {id:jobId,listId:job.list_id,version:version+1,restoredPending:rows.length}
}
