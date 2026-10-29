import { Buffer } from 'node:buffer'
import { fail } from '../db'

type RecordValue = Record<string,any>
export type BloomerangSnapshot = { constituents:RecordValue[]; timelines:Record<string,Record<string,RecordValue[]>> }
const sections = ['Notes','Interactions','Donations','RecurringDonations','RecurringDonationPayments','Pledges','PledgePayments','Tasks'] as const
const endpoints:Record<string,string> = {Notes:'Note',Interactions:'Interaction',Donations:'Donation',RecurringDonations:'RecurringDonation',RecurringDonationPayments:'RecurringDonationPayment',Pledges:'Pledge',PledgePayments:'PledgePayment',Tasks:'Task'}
export const sourceId = (value:unknown) => {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)fail('BLOOMERANG_SCHEMA','Bloomerang returned a missing or invalid numeric source ID.',502)
 return String(value)
}

/** Documented v1 GET doors, authenticated with the raw private key as Basic username.
 * https://bloomerang.com/api/rest-api-v1 — never follow a provider redirect with a key. */
export async function readBloomerang(apiKey:string):Promise<BloomerangSnapshot> {
 if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>500||/[\s:\x00-\x1f]/.test(apiKey))fail('BLOOMERANG_CONNECTION','Supply the nonprofit’s Bloomerang private API key.',400)
 let calls=0,bytes=0
 const read=async(path:string):Promise<any>=>{
  if(++calls>1500)fail('BLOOMERANG_LIMIT','This account exceeds the bounded REST preview. Nothing was applied; use reviewed exports instead.',400)
  let response:Response
  try{response=await fetch('https://api.bloomerang.com/v1'+path,{method:'GET',headers:{authorization:'Basic '+apiKey+':',accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)})}
  catch{fail('BLOOMERANG_UNAVAILABLE','Bloomerang could not be read. No records were applied. Check the connection and preview again.',502)}
  if(!response.ok)fail('BLOOMERANG_UNAVAILABLE',`Bloomerang returned HTTP ${response.status}. No records were applied. Check read access and preview again.`,502)
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0
  if(!reader)fail('BLOOMERANG_SCHEMA','Bloomerang returned an empty response.',502)
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;bytes+=value.length;if(length>2*1024*1024||bytes>12*1024*1024){await reader.cancel();fail('BLOOMERANG_LIMIT','This preview exceeds the response size bound. Nothing was applied; use reviewed exports.',400)}chunks.push(value)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('BLOOMERANG_SCHEMA','Bloomerang returned an unreadable response. Nothing was applied.',502)}
 }
 const accounts:RecordValue[]=[],seen=new Set<string>();let total:number|undefined,finished=false
 for(let page=0;page<200;page++){
  const data=await read('/Constituent?skip='+accounts.length+'&take=50')
  if(!data||!Array.isArray(data.Results)||data.Start!==accounts.length||!Number.isSafeInteger(data.Total)||data.Total<0||data.Total>10000||!Number.isSafeInteger(data.MaxItems)||data.MaxItems<1||data.MaxItems>50||data.Results.length>data.MaxItems||total!==undefined&&total!==data.Total)fail('BLOOMERANG_PAGINATION','Bloomerang pagination changed or is incomplete. Nothing was applied; preview again.',502)
  total=data.Total
  for(const account of data.Results){const id=sourceId(account?.Id);if(seen.has(id))fail('BLOOMERANG_PAGINATION','Bloomerang repeated a constituent across pages. Nothing was applied.',502);seen.add(id);accounts.push(account)}
  if(accounts.length>data.Total)fail('BLOOMERANG_PAGINATION','Bloomerang returned more constituents than its source count.',502)
  if(accounts.length===data.Total){finished=true;break}
  if(!data.Results.length)fail('BLOOMERANG_PAGINATION','Bloomerang stopped before its source count. Nothing was applied.',502)
 }
 if(!finished)fail('BLOOMERANG_LIMIT','Bloomerang pagination did not finish within this preview. Nothing was applied.',400)
 const snapshot:BloomerangSnapshot={constituents:[],timelines:{}},recordIds=new Set<string>()
 for(const account of accounts){
  const id=sourceId(account.Id),detail=await read('/Constituent/'+id)
  if(sourceId(detail?.Id)!==id)fail('BLOOMERANG_SCHEMA','Constituent detail does not match the requested source ID.',502)
  snapshot.constituents.push(detail)
  const timeline=await read('/Timeline/'+id)
  if(!timeline||sourceId(timeline.Id)!==id||sections.some(section=>!Array.isArray(timeline[section]))||Object.entries(timeline).some(([key,value])=>!['Id',...sections].includes(key as any)&&Array.isArray(value)&&value.length))fail('BLOOMERANG_SCHEMA','A Bloomerang timeline is incomplete or contains an unsupported record classification. Nothing was omitted.',502)
  const entries:Record<string,RecordValue[]>={}
  for(const section of sections){
   entries[section]=[]
   for(const item of timeline[section]){
    const entryId=sourceId(typeof item==='number'?item:item?.Id),key=section+':'+entryId
    if(recordIds.has(key))fail('BLOOMERANG_SCHEMA','Bloomerang repeated a source timeline record. Nothing was counted twice.',502)
    recordIds.add(key)
    const record=await read('/'+endpoints[section]+'/'+entryId)
    if(sourceId(record?.Id)!==entryId||sourceId(record?.AccountId)!==id)fail('BLOOMERANG_SCHEMA','A timeline record has a missing or mismatched constituent or source ID.',502)
    entries[section].push(record)
   }
  }
  snapshot.timelines[id]=entries
 }
 return snapshot
}
