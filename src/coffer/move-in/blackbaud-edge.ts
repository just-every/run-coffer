import { Buffer } from 'node:buffer'
import { fail } from '../db'

type SourceRow=Record<string,any>
/** Fixed SKY origins and GET requests only. Neither credential nor raw response is retained. */
export function blackbaudReader(connection:{accessToken:string;subscriptionKey:string}) {
 if(!connection||[connection.accessToken,connection.subscriptionKey].some(v=>typeof v!=='string'||!v.trim()||v.length>4000||/[\r\n]/.test(v)))fail('SKY_CONNECTION','Supply a current Blackbaud access token and subscription key for this read.',400)
 let calls=0,totalBytes=0
 const read=async(path:string):Promise<any>=>{
  if(++calls>1500)fail('SKY_LIMIT','This account exceeds the bounded SKY preview. Nothing was applied.',400)
  let response:Response
  try{response=await fetch('https://api.sky.blackbaud.com'+path,{method:'GET',headers:{authorization:'Bearer '+connection.accessToken,'Bb-Api-Subscription-Key':connection.subscriptionKey,accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)})}
  catch{fail('SKY_UNAVAILABLE','Blackbaud could not be read. Nothing was applied; check the connection before previewing again.',502)}
  if(!response.ok)fail('SKY_UNAVAILABLE',`Blackbaud returned HTTP ${response.status}. Nothing was applied; check read permissions before previewing again.`,502)
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0
  if(!reader)fail('SKY_SCHEMA','Blackbaud returned an empty response.',502)
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;totalBytes+=value.length;if(bytes>2*1024*1024||totalBytes>16*1024*1024){await reader.cancel();fail('SKY_LIMIT','This SKY response exceeds the bounded preview. Nothing was applied.',400)}chunks.push(value)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('SKY_SCHEMA','Blackbaud returned unreadable JSON. Nothing was applied.',502)}
 }
 const list=async(path:string):Promise<SourceRow[]>=>{
  const base=new URL('https://api.sky.blackbaud.com'+path),rows:SourceRow[]=[],ids=new Set<string>();let count:number|undefined,offset=0
  for(let page=0;page<100;page++){
   const url=new URL(base);url.searchParams.set('limit','100');url.searchParams.set('offset',String(offset))
   const result=await read(url.pathname+url.search),values=result?.value
   if(!Array.isArray(values)||!Number.isSafeInteger(result.count)||result.count<0||result.count>10000||count!==undefined&&count!==result.count)fail('SKY_PAGINATION','Blackbaud counts changed or are incomplete. Nothing was applied.',502)
   count=result.count
   for(const row of values){if(!row||typeof row.id!=='string'||!row.id||row.id.length>100||ids.has(row.id))fail('SKY_PAGINATION','Blackbaud returned missing or repeated record identities. Nothing was applied.',502);ids.add(row.id);rows.push(row)}
   if(rows.length>count!)fail('SKY_PAGINATION','Blackbaud returned more records than its source count.',502)
   if(rows.length===count){if(result.next_link)fail('SKY_PAGINATION','Blackbaud pagination contradicts its terminal count.',502);return rows}
   if(!values.length||typeof result.next_link!=='string')fail('SKY_PAGINATION','Blackbaud pagination ended before every source record arrived. Nothing was applied.',502)
   // Never send credentials to a source-supplied host or a different object door.
   let next:URL;try{next=new URL(result.next_link)}catch{fail('SKY_PAGINATION','Blackbaud returned an invalid next page.',502)}
   offset+=values.length
   if(next.origin!==base.origin||next.pathname!==base.pathname||next.username||next.password||next.hash||next.searchParams.get('offset')!==String(offset)||[...base.searchParams].some(([k,v])=>next.searchParams.get(k)!==v)||[...next.searchParams.keys()].some(k=>!['limit','offset',...base.searchParams.keys()].includes(k)))fail('SKY_PAGINATION','Blackbaud returned an unsupported next page. Nothing was applied.',502)
  }
  return fail('SKY_LIMIT','Too many Blackbaud pages for this review.',400)
 }
 return {read,list}
}
