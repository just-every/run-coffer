import { prepareSolicitationRun, solicitationAskStatements, solicitationReason, solicitationState } from './solicitation'
import { fail, one, type Context, type Row } from './db'

export const askFlag=(p:Row,defaultValue=true)=>p.isAsk===undefined?defaultValue:p.isAsk===true||p.isAsk==='true'||p.isAsk==='1'
export async function phoneHold(c:Context,donorId:string,isAsk:boolean) {
 const permission=await one(c,"SELECT status FROM cf_consents WHERE donor_id=? AND channel='phone' ORDER BY id DESC LIMIT 1",donorId)
 if(permission?.status==='withdrawn')return 'phone consent withdrawn'
 return isAsk?(await solicitationReason(c,donorId,'phone',c.now))?.reason??null:null
}
export async function withTaskRestrictions(c:Context,rows:Row[]) {
 const restrictions=await solicitationState(c,rows.map(r=>r.donor_id).filter(Boolean))
 for(const row of rows){row.solicitation=restrictions.find(s=>s.donor_id===row.donor_id);row.solicitationHold=row.donor_id?await phoneHold(c,row.donor_id,!!row.is_ask):null}
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
