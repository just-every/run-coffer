import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row, type Stmt } from './db'
import { listMembers } from './list-members'
import { customValue } from './custom-fields'
import { statusChange, STATUSES } from './status'
import { solicitationWriteStatements } from './solicitation'

// Snapshots remain private, portable and erased with the constituent. Histories
// are append-only: undo records a new version rather than rewriting an old one.
const profileColumns=['constituent_status','status_reason','deceased_on','status_changed_at','status_changed_by']
const originals=(donorId:string)=>({sql:'SELECT s.* FROM cf_solicitation s WHERE s.donor_id=? OR s.donor_id IN(SELECT donor_id FROM cf_donor_merges WHERE into_id=?) ORDER BY s.donor_id',params:[donorId,donorId]})
export async function snapshot(c:Context,donorId:string) {
 const restriction=originals(donorId)
 const [profile,custom,restrictions,calls,series,enrollments,steps]=await Promise.all([
  one(c,`SELECT ${profileColumns.join(',')} FROM cf_donors WHERE id=?`,donorId),
  all(c,'SELECT * FROM cf_custom_values WHERE record_id=? ORDER BY field_key',donorId),all(c,restriction.sql,...restriction.params),
  all(c,'SELECT * FROM cf_call_tasks WHERE donor_id=? ORDER BY id',donorId),
  all(c,'SELECT t.* FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE s.donor_id=? ORDER BY t.id',donorId),
  all(c,'SELECT * FROM cf_welcome_enrollments WHERE donor_id=? ORDER BY donor_id',donorId),
  all(c,'SELECT * FROM cf_welcome_steps WHERE donor_id=? ORDER BY id',donorId),
 ])
 return {profile,custom,restrictions,calls,series,enrollments,steps}
}
type Snapshot=Awaited<ReturnType<typeof snapshot>>
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
async function assertSnapshot(c:Context,donorId:string,expected:Snapshot) {
 if(!same(await snapshot(c,donorId),expected))fail('BULK_CHANGED','A profile, custom value, restriction, task or journey changed after this action. Undo would overwrite newer work.',409)
}
export function stateGuard(donorId:string,expected:Snapshot):Stmt {
 // The same-transaction fingerprint includes every store an undo can restore.
 const tables=[['cf_custom_values','record_id','field_key'],['cf_call_tasks','donor_id','id'],['cf_welcome_enrollments','donor_id','donor_id'],['cf_welcome_steps','donor_id','id']] as const
 const parts: string[]=[],params:unknown[]=[]
 for(const [table,key,order] of tables){
  const rows=table==='cf_custom_values'?expected.custom:table==='cf_call_tasks'?expected.calls:table==='cf_welcome_enrollments'?expected.enrollments:expected.steps
  // json_object keys use trusted schema columns only, never request fields.
  if(rows.length){const cols=Object.keys(rows[0]);parts.push(`(SELECT json_group_array(json_object(${cols.flatMap(k=>["'"+k+"'",k]).join(',')})) FROM (SELECT * FROM ${table} WHERE ${key}=? ORDER BY ${order}))=?`);params.push(donorId,JSON.stringify(rows))}
  else {parts.push(`NOT EXISTS(SELECT 1 FROM ${table} WHERE ${key}=?)`);params.push(donorId)}
 }
 for(const row of expected.restrictions){parts.push('EXISTS(SELECT 1 FROM cf_solicitation WHERE donor_id=? AND version=?)');params.push(row.donor_id,row.version)}
 parts.push('(SELECT COUNT(*) FROM cf_solicitation WHERE donor_id=? OR donor_id IN(SELECT donor_id FROM cf_donor_merges WHERE into_id=?))=?');params.push(donorId,donorId,expected.restrictions.length)
 for(const row of expected.series){parts.push('EXISTS(SELECT 1 FROM cf_recurring_tasks WHERE id=? AND version=?)');params.push(row.id,row.version)}
 parts.push('(SELECT COUNT(*) FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE s.donor_id=?)=?');params.push(donorId,expected.series.length)
 return guard(parts.join(' AND '),'BULK_CHANGED','The constituent changed while preparing the bulk action.',...params)
}
export function updateRow(table:string,row:Row,keys:string[]):Stmt {
 const cols=Object.keys(row).filter(k=>!keys.includes(k)&&k!=='version')
 return sql(`UPDATE ${table} SET ${cols.map(k=>k+'=?').join(',')}${'version' in row?',version=version+1':''} WHERE ${keys.map(k=>k+'=?').join(' AND ')}`,...cols.map(k=>row[k]),...keys.map(k=>row[k]))
}
export async function profileBulkCommand(c:Context,command:string,p:Row,options:{maxRows?:number;auditAction?:'list.solicitation'}={}):Promise<Row|undefined> {
 if(!['list.profile','list.profileUndo'].includes(command))return
 requireRole(c.actor,['owner','admin'],'change live-list profiles')
 if(command==='list.profileUndo'){
  const jobId=id(p.jobId,'Bulk action'),version=integer(Number(p.version),'Action version',1),job=await one(c,"SELECT * FROM cf_list_bulk_jobs WHERE id=? AND kind<>'tags-manager'",jobId)
  if(!job||job.undone_at||job.version!==version)fail('VERSION','This action changed or was already undone.')
  const rows=await all(c,'SELECT * FROM cf_list_bulk_rows WHERE job_id=? ORDER BY donor_id',jobId),writes:Stmt[]=[]
  if(!rows.length)fail('NOT_FOUND','No records remain to undo.',404)
  for(const row of rows){
   const before:Snapshot=JSON.parse(row.before_state),after:Snapshot=JSON.parse(row.after_state)
   await assertSnapshot(c,row.donor_id,after)
   writes.push(guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','BULK_CHANGED','A constituent changed after the bulk action.',row.donor_id,row.donor_version,row.donor_id),stateGuard(row.donor_id,after))
   if(job.kind==='custom')for(const current of after.custom){
    const prior=before.custom.find(v=>v.field_key===current.field_key)
    if(same(prior,current))continue
    const value=prior?.value??'null',next=current.version+1
    writes.push(sql('UPDATE cf_custom_values SET value=?,version=?,source=?,updated_at=? WHERE field_key=? AND record_id=?',value,next,'bulk undo '+jobId,c.now,current.field_key,row.donor_id),sql('INSERT INTO cf_custom_value_history VALUES(?,?,?,?,?,?,?,?)',current.field_key,row.donor_id,row.donor_id,next,value,'bulk undo '+jobId,c.now,c.actor.id))
   }
   if(job.kind==='status'){
    const restored:Row={...before.profile,...(before.profile!.constituent_status!==after.profile!.constituent_status?{status_changed_at:c.now,status_changed_by:c.actor.name}:{})}
    writes.push(sql(`UPDATE cf_donors SET ${profileColumns.map(k=>k+'=?').join(',')} WHERE id=?`,...profileColumns.map(k=>restored[k]),row.donor_id))
   }
   if(job.kind==='solicitation')for(const current of after.restrictions){
    const prior=before.restrictions.find(v=>v.donor_id===current.donor_id),next=current.version+1
    const value:Row={...current,...(prior??{type:'none',channels:'[]',max_asks:null}),version:next,source:'person',source_ref:'bulk undo '+jobId,recorded_at:c.now,recorded_by_id:c.actor.id,recorded_by_name:c.actor.name}
    writes.push(updateRow('cf_solicitation',value,['donor_id']),sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',current.donor_id,next,JSON.stringify({type:value.type,channels:JSON.parse(value.channels),source:'person',sourceRef:value.source_ref,sourceOn:value.source_on,actorId:c.actor.id,actorName:c.actor.name,at:c.now,undoOf:jobId})))
   }
   writes.push(sql('UPDATE cf_donors SET version=version+1 WHERE id=?',row.donor_id),event(c,'list.profileUndo','donor',row.donor_id,row.donor_id,{jobId,kind:job.kind,...(job.kind==='status'?{from:after.profile!.constituent_status,to:before.profile!.constituent_status}:{})}))
  }
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_list_bulk_jobs WHERE id=? AND version=? AND undone_at IS NULL)','VERSION','This action changed.',jobId,version),...writes,sql('UPDATE cf_list_bulk_rows SET donor_version=donor_version+1 WHERE job_id=?',jobId),sql('UPDATE cf_list_bulk_jobs SET version=version+1,undone_at=? WHERE id=?',c.now,jobId),event(c,command,'list_bulk',jobId,null,{count:rows.length,kind:job.kind,restoredPending:false})])
  return {id:jobId,version:version+1,undone:rows.length}
 }
 const listId=id(p.listId,'Saved list'),version=integer(Number(p.version),'List version',1),reason=text(p.reason,'Reason',1000),kind=choice(p.kind,['custom','status','solicitation'] as const,'bulk action')
 const list=await one(c,'SELECT version FROM cf_saved_lists WHERE id=?',listId)
 if(!list||list.version!==version)fail('VERSION','This saved list changed.')
 const {ids,selection,guards}=await listMembers(c,listId)
 const maxRows=options.maxRows??100
 if(!ids.length||ids.length>maxRows)fail('INPUT',`A profile bulk action needs 1–${maxRows} constituents. Narrow the live list.`,400)
 const jobId=newId(),writes:Stmt[]=[],beforeStates:Snapshot[]=[],donorVersions:number[]=[]
 let field:Row|null=null,value:string|null=null
 if(kind==='custom'){
  field=await one(c,"SELECT * FROM cf_custom_fields WHERE key=? AND kind='constituent'",text(p.key,'Custom field key',80));if(!field)fail('INPUT','Choose a constituent custom field.',400)
  let input=p.value;if(field.entry==='pick-many'&&typeof input==='string'){try{input=JSON.parse(input)}catch{fail('INPUT','Choose a JSON list of values.',400)}}
  value=customValue(field,input)
  guards.push(guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','VERSION','The custom field changed.',field.key,field.version))
 }
 for(const donorId of ids){
  const donor=(await one(c,'SELECT * FROM cf_donors WHERE id=?',donorId))!,before=await snapshot(c,donorId)
  beforeStates.push(before);donorVersions.push(donor.version)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','VERSION','A constituent changed.',donorId,donor.version,donorId),stateGuard(donorId,before))
  if(kind==='custom'){
   const next=(before.custom.find(v=>v.field_key===field!.key)?.version??0)+1
   writes.push(sql('INSERT INTO cf_custom_values VALUES(?,?,?,?,?,?,?) ON CONFLICT(field_key,record_id) DO UPDATE SET value=excluded.value,version=excluded.version,source=excluded.source,updated_at=excluded.updated_at',field!.key,donorId,donorId,value,next,'bulk '+jobId,c.now),sql('INSERT INTO cf_custom_value_history VALUES(?,?,?,?,?,?,?,?)',field!.key,donorId,donorId,next,value,'bulk '+jobId,c.now,c.actor.id))
  }
  if(kind==='status'){
   const status=choice(p.status,STATUSES,'constituent status'),change=await statusChange(c,donor,p,status)
   writes.push(...change.statements,sql(`UPDATE cf_donors SET constituent_status=?,${Object.keys(change.columns).map(k=>k+'=?').join(',')} WHERE id=?`,status,...Object.values(change.columns),donorId),...change.after)
  }
  if(kind==='solicitation')writes.push(...(await solicitationWriteStatements(c,{...p,donorId,version:before.restrictions.find(v=>v.donor_id===donorId)?.version??0,source:'person',sourceRef:reason})).statements)
  writes.push(sql('UPDATE cf_donors SET version=version+1 WHERE id=?',donorId),event(c,'list.profile','donor',donorId,donorId,{jobId,kind}))
 }
 // Persist snapshots within the mutation batch using SQL reads. The before state
 // is checked above; the after state is materialized after every consequence.
 const schema=new Map<string,string[]>()
 for(const table of ['cf_custom_values','cf_solicitation','cf_call_tasks','cf_recurring_tasks','cf_welcome_enrollments','cf_welcome_steps'])schema.set(table,(await all(c,`PRAGMA table_info(${table})`)).map(r=>String(r.name)))
 const snapshotSql=(donorId:string)=>{
  const obj=(table:string,where:string,order:string,keys:string[])=>`(SELECT json_group_array(json_object(${keys.flatMap(k=>["'"+k+"'",k]).join(',')})) FROM (SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}))`
  const literal="'"+donorId.replaceAll("'","''")+"'",props=["'profile'",`json_object(${profileColumns.flatMap(k=>["'"+k+"'",`(SELECT ${k} FROM cf_donors WHERE id=${literal})`]).join(',')})`]
  for(const [key,table,where,order] of [['custom','cf_custom_values',`record_id=${literal}`,'field_key'],['restrictions','cf_solicitation',`donor_id=${literal} OR donor_id IN(SELECT donor_id FROM cf_donor_merges WHERE into_id=${literal})`,'donor_id'],['calls','cf_call_tasks',`donor_id=${literal}`,'id'],['series','cf_recurring_tasks',`series_id IN(SELECT id FROM cf_recurring_task_series WHERE donor_id=${literal})`,'id'],['enrollments','cf_welcome_enrollments',`donor_id=${literal}`,'donor_id'],['steps','cf_welcome_steps',`donor_id=${literal}`,'id']])props.push("'"+key+"'",obj(table,where,order,schema.get(table)!))
  return `json_object(${props.join(',')})`
 }
 const receipts:Stmt[]=[]
 for(const [i,donorId] of ids.entries())receipts.push(sql(`INSERT INTO cf_list_bulk_rows(job_id,donor_id,donor_version,before_state,after_state) SELECT ?,?,?,?,${snapshotSql(donorId)}`,jobId,donorId,donorVersions[i]+1,JSON.stringify(beforeStates[i])))
 await commit(c,[...guards,guard('EXISTS(SELECT 1 FROM cf_saved_lists WHERE id=? AND version=?)','VERSION','The list changed.',listId,version),guard(`(WITH ${selection.ctes} SELECT (SELECT COUNT(*) FROM members)=? AND NOT EXISTS(SELECT 1 FROM members WHERE id NOT IN(SELECT value FROM json_each(?))))`,'LIST_CHANGED','Live membership changed. Review it again.',...selection.params,ids.length,JSON.stringify(ids)),sql('INSERT INTO cf_list_bulk_jobs(id,list_id,list_version,reason,created_at,created_by,kind) VALUES(?,?,?,?,?,?,?)',jobId,listId,version,reason,c.now,c.actor.id,kind),...writes,...receipts,event(c,options.auditAction??command,options.auditAction?'saved_list':'list_bulk',options.auditAction?listId:jobId,null,{jobId,listId,count:ids.length,kind,type:kind==='solicitation'?p.type:undefined,reasonRecorded:true})])
 return {id:jobId,listId,version:1,changed:ids.length,kind}
}
