import { prepareSolicitationRun, solicitationAskStatements, solicitationReasons, solicitationState } from './solicitation'
import { all, fail, one, type Context, type Row } from './db'

export const askFlag=(p:Row,defaultValue=true)=>p.isAsk===undefined?defaultValue:p.isAsk===true||p.isAsk==='true'||p.isAsk==='1'
export async function phoneHolds(c:Context,donorIds:string[],isAsk:boolean) {
 const ids=[...new Set(donorIds)],holds=new Map<string,string|null>(ids.map(d=>[d,null]))
 if(!ids.length)return holds
 const [permissions,reasons]=await Promise.all([
  all(c,`SELECT d.id,d.constituent_status,k.status AS permission FROM cf_donors d LEFT JOIN cf_consents k ON k.id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=d.id AND channel='phone') WHERE d.id IN (SELECT value FROM json_each(?))`,JSON.stringify(ids)),
  isAsk?solicitationReasons(c,ids,'phone',c.now):Promise.resolve(new Map()),
 ])
 for(const p of permissions)holds.set(p.id,p.constituent_status!=='active'?p.constituent_status:p.permission==='withdrawn'?'phone consent withdrawn':reasons.get(p.id)?.reason??null)
 return holds
}
export async function phoneHold(c:Context,donorId:string,isAsk:boolean) {
 return (await phoneHolds(c,[donorId],isAsk)).get(donorId)??null
}
export async function withTaskRestrictions(c:Context,rows:Row[]) {
 const ids=rows.map(r=>r.donor_id).filter(Boolean)
 const [restrictions,holds]=await Promise.all([solicitationState(c,ids),phoneHolds(c,ids,true)])
 const byDonor=new Map(restrictions.map(r=>[r.donor_id,r]))
 for(const row of rows){
  row.solicitation=byDonor.get(row.donor_id)
  const hold=holds.get(row.donor_id)??null
  row.solicitationHold=!row.is_ask&&(hold==='do not solicit'||hold==='solicitation limit')?null:hold
 }
 return rows
}
export async function completedAsk(c:Context,task:Row,p:Row) {
 const permission=await one(c,"SELECT status FROM cf_consents WHERE donor_id=? AND channel='phone' ORDER BY id DESC LIMIT 1",task.donor_id)
 if(permission?.status==='withdrawn')fail('PHONE_CONSENT','Phone consent is withdrawn; no ask call may be completed through this task.')
 if(!task.is_ask)return []
 const classification=await prepareSolicitationRun(c,{kind:'call',id:task.id,channel:'phone',isAsk:true,donorIds:[task.donor_id],includes:p.includeReason?[{donorId:task.donor_id,reason:p.includeReason}]:[]})
 if(classification.excluded.length)fail('SOLICITATION_RESTRICTED',classification.excluded[0].reason)
 return [...classification.statements,...await solicitationAskStatements(c,'call',task.id,[task.donor_id],classification)]
}
