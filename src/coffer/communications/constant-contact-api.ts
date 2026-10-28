import { fail, type Row } from '../db'
import type { Connection } from './connection'

export function ccPart(value:unknown):string {
 if(typeof value!=='string'||!value||value==='.'||value==='..')fail('CONSTANT_CONTACT_RESPONSE','Constant Contact returned an invalid identifier.',502)
 return encodeURIComponent(value)
}
export async function ccRequest(conn:Connection,path:string,method='GET',body?:unknown,missing=false):Promise<any>{
 let response:Response
 try{
  response=await fetch('https://api.cc.email/v3'+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+conn.credential,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
 }catch{return fail('CONSTANT_CONTACT_UNREACHABLE','Constant Contact did not confirm this request. Review the saved campaign before submitting again.',502)}
 if(missing&&response.status===404)return null
 if(!response.ok)fail('CONSTANT_CONTACT_REFUSED',`Constant Contact refused this request (HTTP ${response.status}). Review the connection and saved campaign.`,502,{providerStatus:response.status})
 if(response.status===204)return {}
 const data=await response.json().catch(()=>null)
 if(!data||typeof data!=='object')fail('CONSTANT_CONTACT_RESPONSE','Constant Contact returned an unreadable answer.',502)
 return data
}
export function ccContact(data:Row,email:string):Row{
 if(data.email_address?.address?.toLowerCase()!==email.toLowerCase()||!['explicit','implicit','unsubscribed','pending_confirmation','temp_hold','not_set'].includes(data.email_address.permission_to_send))fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not confirm this contact and its current permission.',502)
 ccPart(data.contact_id)
 return {...data,id:data.contact_id,email:email.toLowerCase(),emailStatus:['explicit','implicit'].includes(data.email_address.permission_to_send)?'subscribed':data.email_address.permission_to_send==='unsubscribed'?'unsubscribed':'suppressed'}
}
export async function constantContactContact(conn:Connection,email:string):Promise<Row|null>{
 const query=new URLSearchParams({email,status:'all',include:'list_memberships,custom_fields'})
 const data=await ccRequest(conn,'/contacts?'+query)
 if(!Array.isArray(data.contacts)||data.contacts.length>1)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact returned an ambiguous contact answer.',502)
 return data.contacts.length?ccContact(data.contacts[0],email):null
}
export async function checkConstantContact(conn:Connection){
 const data=await ccRequest(conn,'/account/emails?limit=100')
 if(!Array.isArray(data))fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not list the verified account addresses.',502)
 for(const email of [conn.senderEmail,conn.fromEmail])if(!data.some((row:Row)=>row.email_address?.toLowerCase()===email?.toLowerCase()&&row.confirm_status==='CONFIRMED'))fail('CONSTANT_CONTACT_SENDER','Confirm both sender and reply-to addresses in Constant Contact before connecting.',409)
 return 'Connected. Constant Contact confirmed the sender and the installed reply address. Campaign submissions require approval; delivery remains unconfirmed.'
}
