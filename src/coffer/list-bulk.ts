import { requireRole } from './auth'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, text, today, type Context, type Row, type Stmt } from './db'
import { listMembers } from './list-members'
import { settings } from './settings'

const descriptors=[
 {table:'cf_donor_tags',columns:['donor_id','tag','created_at','created_by'],order:'tag'},
 {table:'cf_portfolio_members',columns:['donor_id','portfolio_id','assigned_on'],order:'donor_id'},
] as const
async function snapshot(c:Context,donorId:string){return Promise.all(descriptors.map(d=>all(c,`SELECT ${d.columns.join(',')} FROM ${d.table} WHERE donor_id=? ORDER BY ${d.order}`,donorId)))}
function exactState(donorId:string,saved:Row[][]):Stmt[]{return descriptors.map((d,i)=>guard(`(SELECT json_group_array(json_object(${d.columns.flatMap(k=>["'"+k+"'",k]).join(',')})) FROM (SELECT ${d.columns.join(',')} FROM ${d.table} WHERE donor_id=? ORDER BY ${d.order}))=?`,'BULK_CHANGED','A record changed after this bulk action. Undo would overwrite newer work.',donorId,JSON.stringify(saved[i])))}

export async function bulkListCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['list.bulk','list.undo'].includes(command))return
 requireRole(c.actor,['owner','admin'],'change a live list')
 if(command==='list.undo'){
  const jobId=id(p.jobId,'Bulk action'),version=integer(Number(p.version),'Bulk action version',1),job=await one(c,'SELECT * FROM cf_list_bulk_jobs WHERE id=?',jobId)
  if(!job||job.kind!=='tags-manager'||job.undone_at||job.version!==version)fail('VERSION','This bulk action changed or was already undone.')
  const rows=await all(c,'SELECT * FROM cf_list_bulk_rows WHERE job_id=? ORDER BY donor_id',jobId)
  if(!rows.length)fail('NOT_FOUND','This bulk action has no remaining records to undo.',404)
  const writes:Stmt[]=[]
  for(const row of rows){
   const before:Row[][]=JSON.parse(row.before_state),after:Row[][]=JSON.parse(row.after_state)
   writes.push(guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','BULK_CHANGED','This constituent changed after the bulk action.',row.donor_id,row.donor_version,row.donor_id),...exactState(row.donor_id,after))
   for(const [index,d] of descriptors.entries())writes.push(sql(`DELETE FROM ${d.table} WHERE donor_id=?`,row.donor_id),...before[index].map(r=>sql(`INSERT INTO ${d.table}(${d.columns.join(',')}) VALUES(${d.columns.map(()=>'?').join(',')})`,...d.columns.map(k=>r[k]))))
   writes.push(sql('UPDATE cf_donors SET version=version+1 WHERE id=?',row.donor_id))
  }
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_list_bulk_jobs WHERE id=? AND version=? AND undone_at IS NULL)','VERSION','This bulk action changed.',jobId,version),...writes,sql('UPDATE cf_list_bulk_jobs SET version=version+1,undone_at=? WHERE id=?',c.now,jobId),event(c,command,'list_bulk',jobId,null,{count:rows.length})])
  return {id:jobId,version:version+1,undone:rows.length}
 }
 const listId=id(p.listId,'Saved list'),version=integer(Number(p.version),'List version',1),reason=text(p.reason,'Reason',1000)
 const list=await one(c,'SELECT version FROM cf_saved_lists WHERE id=?',listId)
 if(!list||list.version!==version)fail('VERSION','This saved list changed.')
 const {ids,selection,guards}=await listMembers(c,listId)
 if(!ids.length||ids.length>500)fail('INPUT','A bulk action needs 1–500 constituents. Narrow the live list.',400)
 let actions=p.actions??[...(p.tag?[{type:p.removeTag==='yes'?'tag.remove':'tag.add',tag:p.tag}]:[]),...(p.portfolioId?[{type:'manager',portfolioId:p.portfolioId}]:[])];if(typeof actions==='string'){try{actions=JSON.parse(actions)}catch{fail('INPUT','Choose bulk actions.',400)}}
 if(!Array.isArray(actions)||!actions.length||actions.length>10)fail('INPUT','Choose 1–10 tag or manager actions.',400)
 const writes:Stmt[]=[],validated:Row[]=[]
 const day=today((await settings(c)).timezone,new Date(c.now)),jobId=newId()
 for(const action of actions){
  if(action.type==='tag.add'||action.type==='tag.remove')validated.push({type:action.type,tag:text(action.tag,'Tag',100)})
  else if(action.type==='manager'){
   const portfolioId=id(action.portfolioId,'Portfolio')
   writes.push(guard("EXISTS(SELECT 1 FROM cf_portfolios p JOIN oa_operators o ON o.id=p.manager_id WHERE p.id=? AND o.status='active' AND o.role IN ('owner','admin','member'))",'MANAGER_CHANGED','Choose a portfolio with an active relationship manager.',portfolioId));validated.push({type:'manager',portfolioId})
  }else fail('INPUT','Choose a supported bulk tag or manager action.',400)
 }
 const snapshots=[]
 for(const donorId of ids){
  const d=(await one(c,'SELECT version FROM cf_donors WHERE id=?',donorId))!,before=await snapshot(c,donorId),after:Row[][]=JSON.parse(JSON.stringify(before))
  for(const action of validated){
   if(action.type==='tag.remove')after[0]=after[0].filter(r=>r.tag!==action.tag)
   if(action.type==='tag.add'&&!after[0].some(r=>r.tag===action.tag))after[0].push({donor_id:donorId,tag:action.tag,created_at:c.now,created_by:c.actor.id})
   if(action.type==='manager')after[1]=[{donor_id:donorId,portfolio_id:action.portfolioId,assigned_on:before[1][0]?.portfolio_id===action.portfolioId?before[1][0].assigned_on:day}]
  }
  after[0].sort((a,b)=>a.tag<b.tag?-1:a.tag>b.tag?1:0)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)','VERSION','A constituent changed during preparation.',donorId,d.version),...exactState(donorId,before))
  for(const [index,descriptor] of descriptors.entries())writes.push(sql(`DELETE FROM ${descriptor.table} WHERE donor_id=?`,donorId),...after[index].map(r=>sql(`INSERT INTO ${descriptor.table}(${descriptor.columns.join(',')}) VALUES(${descriptor.columns.map(()=>'?').join(',')})`,...descriptor.columns.map(k=>r[k]))))
  writes.push(sql('UPDATE cf_donors SET version=version+1 WHERE id=?',donorId))
  snapshots.push(sql('INSERT INTO cf_list_bulk_rows VALUES(?,?,?,?,?)',jobId,donorId,d.version+1,JSON.stringify(before),JSON.stringify(after)))
 }
 await commit(c,[...guards,guard('EXISTS(SELECT 1 FROM cf_saved_lists WHERE id=? AND version=?)','VERSION','The list changed.',listId,version),guard(`(WITH ${selection.ctes} SELECT (SELECT COUNT(*) FROM members)=? AND NOT EXISTS(SELECT 1 FROM members WHERE id NOT IN(SELECT value FROM json_each(?))))`,'LIST_CHANGED','Live list membership changed. Review it again.',...selection.params,ids.length,JSON.stringify(ids)),sql('INSERT INTO cf_list_bulk_jobs(id,list_id,list_version,reason,created_at,created_by) VALUES(?,?,?,?,?,?)',jobId,listId,version,reason,c.now,c.actor.id),...writes,...snapshots,event(c,command,'list_bulk',jobId,null,{listId,count:ids.length,actionTypes:validated.map(a=>a.type),reasonRecorded:true})])
 return {id:jobId,listId,version:1,changed:ids.length}
}
