import { requireRole } from './auth'
import { commit, date, event, fail, guard, id, newId, one, sql, text, type Context, type Row, type Stmt } from './db'
import { listMembers } from './list-members'
import { askFlag, phoneHolds } from './solicitation-tasks'
import { prepareSolicitationRun, solicitationRunGuards } from './solicitation'

/** Explicit creation of ordinary owned calls, never an outbound contact. */
export async function listTasksCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='list.tasks')return
 requireRole(c.actor,['owner','admin'],'create list call tasks')
 const listId=id(p.listId,'Saved list'),version=Number(p.version),ownerId=id(p.ownerId,'Task owner'),due=date(p.dueOn,'Due date'),reason=text(p.reason,'Call reason',1000),isAsk=askFlag(p)
 const list=await one(c,'SELECT version FROM cf_saved_lists WHERE id=?',listId)
 if(!list||list.version!==version)fail('VERSION','The saved list changed.')
 const members=await listMembers(c,listId)
 if(!members.ids.length||members.ids.length>100)fail('INPUT','Choose a live list of 1–100 constituents.',400)
 const holds=await phoneHolds(c,members.ids,isAsk),excluded:Record<string,number>={},writes:Stmt[]=[],tasks:Row[]=[]
 for(const donorId of members.ids){
  const hold=holds.get(donorId);if(hold){excluded[hold]=(excluded[hold]??0)+1;continue}
  const key='list:'+listId+':'+donorId,existing=await one(c,'SELECT id FROM cf_call_tasks WHERE source_key=?',key)
  if(existing){excluded['existing list task']=(excluded['existing list task']??0)+1;continue}
  const taskId=newId(),permission=await one(c,"SELECT id FROM cf_consents WHERE donor_id=? AND channel='phone' ORDER BY id DESC LIMIT 1",donorId)
  const classified=await prepareSolicitationRun(c,{kind:'call-task',id:taskId,channel:'phone',isAsk,donorIds:[donorId]})
  if(classified.excluded.length){const why=classified.excluded[0].reason;excluded[why]=(excluded[why]??0)+1;continue}
  writes.push(guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND constituent_status='active' AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)",'DONOR_CHANGED','A list member changed.',donorId,donorId),guard("(SELECT id FROM cf_consents WHERE donor_id=? AND channel='phone' ORDER BY id DESC LIMIT 1) IS ?",'CONSENT_CHANGED','Phone consent changed. Review the list again.',donorId,permission?.id??null),...classified.statements,...await solicitationRunGuards(c,'call-task',taskId,[donorId],classified),sql("INSERT INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask) VALUES(?,?,?,'saved-list',?,0,?,?,?,?)",taskId,donorId,key,reason,ownerId,due,c.now,isAsk?1:0))
  tasks.push({id:taskId,donorId})
 }
 await commit(c,[...members.guards,guard('EXISTS(SELECT 1 FROM cf_saved_lists WHERE id=? AND version=?)','VERSION','The list changed.',listId,version),guard(`(WITH ${members.selection.ctes} SELECT (SELECT COUNT(*) FROM members)=? AND NOT EXISTS(SELECT 1 FROM members WHERE id NOT IN(SELECT value FROM json_each(?))))`,'LIST_CHANGED','Live membership changed.',...members.selection.params,members.ids.length,JSON.stringify(members.ids)),guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",'OWNER_CHANGED','Choose an active task owner.',ownerId),...writes,event(c,command,'saved_list',listId,null,{count:tasks.length,excluded,isAsk,ownerId,dueOn:due})])
 return {listId,tasks,created:tasks.length,excluded}
}
