import { Buffer } from 'node:buffer'
import { fail } from '../db'

type RecordValue = Record<string,any>
export type NeonSnapshot = { accounts:RecordValue[]; tenders:RecordValue[]; definitions:RecordValue[]; donations:RecordValue[]; activities:RecordValue[]; registrations:RecordValue[]; households:RecordValue[] }
/** Neon v2.12 public schema: https://developer.neoncrm.com/api-v2/
 * Read-only endpoints, fixed provider origin, no stored connection or raw payment data. */
export async function readNeon(connection:{organizationId:string;apiKey:string}):Promise<NeonSnapshot> {
 if(!connection||typeof connection.organizationId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(connection.organizationId)||typeof connection.apiKey!=='string'||!connection.apiKey.trim()||connection.apiKey.length>500)fail('NEON_CONNECTION','Supply your Neon organization ID and API key.',400)
 const authorization='Basic '+Buffer.from(connection.organizationId+':'+connection.apiKey).toString('base64')
 let calls=0,bytes=0
 const read=async(path:string,body?:unknown):Promise<any>=>{
  if(++calls>1500)fail('NEON_LIMIT','This Neon account exceeds the current bounded API slice. Use a smaller reviewed migration; nothing was applied.',400)
  let response:Response
  try{response=await fetch('https://api.neoncrm.com/v2'+path,{method:body?'POST':'GET',headers:{authorization,'NEON-API-VERSION':'2.12','content-type':'application/json',accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})})}
  catch{fail('NEON_UNAVAILABLE','Neon could not be read. No records were applied. Retry the preview after checking the connection.',502)}
  if(!response.ok)fail('NEON_UNAVAILABLE',`Neon returned HTTP ${response.status}. No records were applied; check read permissions and retry the preview.`,502)
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0
  if(!reader)fail('NEON_SCHEMA','Neon returned an empty response.',502)
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;bytes+=value.length;if(length>2*1024*1024||bytes>12*1024*1024){await reader.cancel();fail('NEON_LIMIT','Neon returned more than this bounded preview can review. Nothing was applied.',400)}chunks.push(value)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('NEON_SCHEMA','Neon returned an unreadable response. Nothing was applied.',502)}
 }
 const paged=async(path:string,key:string,searchField?:string):Promise<RecordValue[]>=>{
  const rows:RecordValue[]=[];let pages:number|undefined,total:number|undefined
  for(let currentPage=0;currentPage<100;currentPage++){
   const data=await read(searchField?path:path+'?currentPage='+currentPage,searchField?{searchFields:[],outputFields:[searchField],pagination:{currentPage,pageSize:100}}:undefined)
   const p=data?.pagination,list=data?.[key]
   if(!Array.isArray(list)||!p||p.currentPage!==currentPage||!Number.isSafeInteger(p.totalPages)||p.totalPages<0||p.totalPages>100||!Number.isSafeInteger(p.totalResults)||p.totalResults<0||p.totalResults>10000||pages!==undefined&&p.totalPages!==pages||total!==undefined&&p.totalResults!==total)fail('NEON_SCHEMA','Neon pagination changed or is incomplete. Preview again; nothing was applied.',502)
   pages=p.totalPages;total=p.totalResults;rows.push(...list)
   if(currentPage+1>=p.totalPages){if(rows.length!==total)fail('NEON_SCHEMA','Neon source counts do not match the records received. Nothing was applied.',502);return rows}
  }
  return fail('NEON_LIMIT','Too many Neon pages for this import.',400)
 }
 const ids=(rows:RecordValue[],field:string)=>{
  const result=rows.map(r=>String(r[field]??''))
  if(result.some(id=>! /^[A-Za-z0-9_-]{1,100}$/.test(id))||new Set(result).size!==result.length)fail('NEON_SCHEMA','Neon returned missing or repeated source IDs.',502)
  return result
 }
 const accountIds=ids(await paged('/accounts/search','searchResults','Account ID'),'Account ID')
 const snapshot:NeonSnapshot={accounts:[],tenders:await read('/payments/tenders'),definitions:await read('/customFields?category=Account'),donations:[],activities:[],registrations:[],households:await read('/households/listHouseholds')}
 if(!Array.isArray(snapshot.tenders)||!Array.isArray(snapshot.definitions)||!Array.isArray(snapshot.households))fail('NEON_SCHEMA','Neon definitions or households were incomplete.',502)
 const donationIds=new Set<string>(),registrationIds=new Set<string>()
 for(const id of accountIds){
  const wrapper=await read('/accounts/'+encodeURIComponent(id)),account=wrapper.individualAccount??wrapper.companyAccount
  if(!account||account.accountId!==id)fail('NEON_SCHEMA','Neon account detail does not match its source ID.',502)
  snapshot.accounts.push({...account,_company:!!wrapper.companyAccount})
  for(const donation of await paged('/accounts/'+id+'/donations','donations')){
   if(donation.accountId!==id||!donation.id||donationIds.has(donation.id))fail('NEON_SCHEMA','Neon donation identity is missing, repeated or mismatched.',502)
   donationIds.add(donation.id);snapshot.donations.push(donation)
  }
  for(const registration of await paged('/accounts/'+id+'/eventRegistrations','eventRegistrations')){
   if(registration.registrantAccountId!==id||!registration.id||registrationIds.has(registration.id))fail('NEON_SCHEMA','Neon registration identity is missing, repeated or mismatched.',502)
   registrationIds.add(registration.id);snapshot.registrations.push(registration)
  }
 }
 for(const id of ids(await paged('/activities/search','searchResults','Activity ID'),'Activity ID')){
  const activity=await read('/activities/'+id)
  if(activity?.id!==id)fail('NEON_SCHEMA','Neon activity detail does not match its source ID.',502)
  snapshot.activities.push(activity)
 }
 return snapshot
}
